/** R7c: ngoại lệ có hướng, chỉ hai asset đã qua native SPA/Express gates R7a/R7b. */
export const CONTROLLER_SPA_ASSET_TRANSITION = [
  {
    path: 'payload/target-helper/target_product_runtime.py',
    mode: 0o600,
    before: {
      size: 46765,
      sha256: 'eb5c697e0051f38e0633bc84e32377fbc91cf4b825c21734f5f611a49b85908d'
    },
    after: {
      size: 47340,
      sha256: '98b0edec5ffb29a114e411d067a551a9a90110cdcf5872ab31dee5246f3e10ff'
    }
  },
  {
    path: 'payload/templates/static-spa.Dockerfile',
    mode: 0o600,
    before: {
      size: 257,
      sha256: 'a3c5cf2585ddca71d7e316c71e733c46c104ed929e12b0c88ab07f24d8d0e4af'
    },
    after: { size: 942, sha256: 'bfb5c3e77b5af306f10ec46797b5777396a92be15bbee8aeea44ea999d7e9ba3' }
  }
] as const
