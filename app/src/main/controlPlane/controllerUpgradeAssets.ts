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

/** R7h-4 candidate, exact bytes; serving approval requires full PG/legacy/Root gates. */
export const CONTROLLER_POSTGRES_ASSET_TRANSITION = [
  {
    path: 'payload/target-helper/target_product_runtime.py',
    mode: 0o600,
    before: {
      size: 51419,
      sha256: 'f591e2f4bd8b1a770204af8645c499ba05955090a32464c1ae5c32dd37443cb5'
    },
    after: {
      size: 85494,
      sha256: '9f8e1fbb6fab90e9266e160b9cbbcec9707c36f455e1962b8462699f03720f1a'
    }
  }
] as const
/** R7h-4b candidate: đọc/đóng stdout lỗi luôn unknown, không chấp nhận kết quả thiếu. */
export const CONTROLLER_POSTGRES_IO_ASSET_TRANSITION = [
  {
    path: 'payload/target-helper/target_product_runtime.py',
    mode: 0o600,
    before: {
      size: 85494,
      sha256: '9f8e1fbb6fab90e9266e160b9cbbcec9707c36f455e1962b8462699f03720f1a'
    },
    after: {
      size: 85777,
      sha256: '95cc98a0fe3692193e66f034ac8bdb8a0e7541e9ee4c5c75b472e18ed37fc343'
    }
  }
] as const
export const CONTROLLER_POSTGRES_IO_BOOTSTRAP_TRANSITION = [
  {
    path: 'payload/target-helper/target_enrollment.py',
    mode: 0o600,
    before: {
      size: 37271,
      sha256: 'e1a00d3c1cc90656a56257c1820a5b1424cef5ac4d8f634f07dcd44990057b25'
    },
    after: {
      size: 37889,
      sha256: '546cba32411870226e63eb36e15edd0f0a015cdcde4ef8f23989bc025f7741ab'
    }
  }
] as const
export const CONTROLLER_POSTGRES_BOOTSTRAP_TRANSITION = [
  {
    path: 'payload/target-helper/target_enrollment.py',
    mode: 0o600,
    before: {
      size: 36931,
      sha256: 'ae2c290726b6fc497489bca962036ac14806bf588086d181498cbc8dcd886c7b'
    },
    after: {
      size: 37271,
      sha256: 'e1a00d3c1cc90656a56257c1820a5b1424cef5ac4d8f634f07dcd44990057b25'
    }
  }
] as const

/** e3a reviewed target transaction bootstrap, exact forward bytes only. */
export const CONTROLLER_HELPER_UPGRADE_BOOTSTRAP_TRANSITION = [
  {
    path: 'payload/target-helper/target_enrollment.py',
    mode: 0o600,
    before: {
      size: 16931,
      sha256: '848aede7f9b49f51b303b1d1d13ad283262ae1b1a21ece0878a1a9bf507e9336'
    },
    after: {
      size: 36931,
      sha256: 'ae2c290726b6fc497489bca962036ac14806bf588086d181498cbc8dcd886c7b'
    }
  }
] as const

/** R7h: helper đã qua native Express/Next/SPA env, exact-CID rollback và legacy gates. */
export const CONTROLLER_ENVIRONMENT_ASSET_TRANSITION = [
  {
    path: 'payload/target-helper/target_product_runtime.py',
    mode: 0o600,
    before: CONTROLLER_SPA_ASSET_TRANSITION[0].after,
    after: {
      size: 51419,
      sha256: 'f591e2f4bd8b1a770204af8645c499ba05955090a32464c1ae5c32dd37443cb5'
    }
  }
] as const
