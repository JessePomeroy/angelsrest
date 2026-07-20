# 2026-07-20 private catalog asset transfer

Status: complete.

This journal records the completed private asset transfer for the Angels Rest
catalog migration. It intentionally excludes source URLs, private object keys,
R2 proof metadata, credentials, upload capabilities, and file contents.

## Scope

- Site: `angelsrest.online`
- Source: published Sanity catalog, `production` dataset
- Target: production Convex deployment `loyal-swan-967`
- Asset set: 12 total
  - 11 print-source image masters
  - 1 paid digital ZIP
- Receipt set:
  `catalog-private-assets-v1:e8d573e1558301bfb52fc108baf227d6d74e4e7fbbc0228d2829ded3d32ac63b`
- Candidate checksum:
  `83350a95c9a3a3207b8b872171b72f2df94cd62edd15b58e3f470a9e6d99b7b7`

## Verification result

- Storage receipt initial status: `pending_inspection`
- Inspection receipt initial status: `verified`
- Storage replay: `true`
- Inspection replay: `true`
- Sanitized local report:
  `/tmp/angelsrest-private-catalog-transfer-report.json`

## Target mappings

| Kind | Asset key | Convex asset ID |
| --- | --- | --- |
| `print_source` | `image-1382b9d3b95996a2d7f612c7d1943f1c63dcb695-2160x1440-jpg` | `q970hm4246ek96y29w5hrsjkvh8axepc` |
| `print_source` | `image-1d015361e8e290c86f182a5bbce9fce7fc05638d-5152x7728-jpg` | `q975n90kd5v4f5yz8navjn2wgd8awefb` |
| `print_source` | `image-2e51660cae40d0ee2add0ff0c394f1a3367a73b3-4657x3105-jpg` | `q9753cev6yk0g5fvq0shzfwtdd8ax9pc` |
| `print_source` | `image-3dd99847dfcbd4a40aa28c9781785f3d397d674b-4647x3098-jpg` | `q97cw906wca9jm4cr2keyfvqq18awbas` |
| `print_source` | `image-4eb6f607de53cc329dafa75645ce38b96459d010-6935x4623-png` | `q97em2xrgehs2gg4jmeajgmj9n8awazy` |
| `print_source` | `image-72dc0a859a243cfe81ca72a19478c5f24e265558-3106x4659-jpg` | `q97306qn1gkqb57npznkma9bq98awr40` |
| `print_source` | `image-7e6898c93b77d12e5116f9a0e380f1cd6ada1f9a-3936x2624-jpg` | `q973v7amz5c2w1psdrdks2nfz58ax2dn` |
| `print_source` | `image-b0a6508aee892051083d6712e082969e0fc87def-4628x3085-jpg` | `q972cqegh8jkemxbann71hegad8awn2z` |
| `print_source` | `image-b613547bfa4de6969a565c5345fef909cab6818d-6935x4623-jpg` | `q9703eb8g26p50w4qxzgt06y0s8axkc4` |
| `print_source` | `image-ca3e7eee636426b3bb1fa5f5537795cad9fdfa73-2160x1440-jpg` | `q974gmhkh4fwpjzy3fzty3pr998ax20n` |
| `print_source` | `image-e99ab36cab090eb18cf258460069f73de2b22ce2-4664x3109-jpg` | `q976dtrph6fzshnrr0r8rygt4x8awhhh` |
| `paid_digital_file` | `file-69ddd31ce4d9f51c978074210560e7249fe7e42f-zip` | `q57679yxvbbbkz74563mvg34gn8axprw` |

## Operational notes

- The transfer used a temporary Worker-only
  `CATALOG_PRIVATE_ASSET_TRANSFER_SECRETS` registry so the local runner did not
  need the ordinary CMS media tenant credential.
- That temporary Worker secret was deleted immediately after the successful
  run.
- The CMS media Worker `CONVEX_SITE_URL` was corrected to the production Convex
  site before the successful run.
- During diagnosis, the Worker receipt post was fixed to use Cloudflare's
  supported `redirect: "manual"` mode. Cloudflare Workers rejects
  `redirect: "error"` at runtime.
- Sanity remains the public catalog authority. This transfer only creates
  verified private asset registry rows for the later unpublished 33-product
  import.
