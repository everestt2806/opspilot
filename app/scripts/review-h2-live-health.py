"""Probe thật bằng Docker CLI; chỉ đọc các container/image fixture do runner cấp."""
import json
import sys
from pathlib import Path

sys.path.insert(0, '/subject')
from target_product_runtime import ProductRuntime, DockerCommands, RuntimeRejected

fixture = json.loads(Path('/live.json').read_text())
subject = ProductRuntime.__new__(ProductRuntime)
subject.context = fixture['context']
subject.app_name = subject.context['app_name'] + '-app'
subject.commands = DockerCommands()
record = subject.commands.inspect('container', fixture['container_id'])
assert record['Config']['Labels'].get('opspilot.review.run') == fixture['nonce']
identity = subject._pin(record, {'deployment_id': subject.context['deployment_id'],
    'source_sha': subject.context['source_sha'], 'image_tag': subject.context['candidate_image_tag']})
results = []
health = subject._health(identity, 2000)
assert health['health'] == 'healthy' and health['http_status'] == 200
results.append('exact_cid_http_200')
for field, value in [('image_id', 'sha256:' + '9' * 64), ('source_sha', '9' * 40),
                     ('config_sha256', '9' * 64)]:
    changed = dict(identity, **{field: value})
    try:
        subject._health(changed, 2000)
    except RuntimeRejected:
        results.append('reject_wrong_' + field)
    else:
        raise AssertionError('identity contradiction accepted')
other = dict(identity, container_id=fixture['foreign_container_id'])
try:
    subject._health(other, 2000)
except RuntimeRejected:
    results.append('reject_http_200_from_other_container')
else:
    raise AssertionError('foreign HTTP 200 accepted')
print(json.dumps({'scope': 'REAL_DOCKER_EXACT_CID_HEALTH_ONLY', 'passed': len(results), 'cases': results}))
