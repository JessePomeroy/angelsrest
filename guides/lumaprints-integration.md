# LumaPrints Integration - Success Logs

## Working Checkout Flow

```
2026-03-09 03:53:17.097 [info] Received webhook: checkout.session.completed
2026-03-09 03:53:17.097 [info] Processing completed checkout: cs_live_a1HT3rRBRx7Zf2jY899wdpXgwgdzD4UirBl5Z64OeubMbfHcB5DVDonWEL
2026-03-09 03:53:18.716 [info] Created order in Sanity: ORD-015 X9ORxzRbtqr9lSJFefIxSw
2026-03-09 03:53:22.942 [info] ✅ Captured Stripe fees: ORD-015 → 33 cents
2026-03-09 03:53:22.943 [info] Submitting to LumaPrints: ORD-015 1 items [{"externalItemId":"li_1T8usKEdZA9bU4XSDUEzoYS0","productName":"minki x kael","quantity":1,"subcategoryId":103001,"width":4,"height":6,"options":[39],"imageUrl":"https://cdn.sanity.io/images/n7rvza4g/production/6a049c3a0013967ab2c39a99a9a62b154d01efee-5152x7728.jpg"}]
2026-03-09 03:53:27.964 [info] ✅ Submitted to LumaPrints: ORD-015 → 10001550663
2026-03-09 03:53:28.189 [info] Checkout processed successfully: cs_live_a1HT3rRBRx7Zf2jY899wdpXgwgdzD4UirBl5Z64OeubMbfHcB5DVDonWEL
```

## Key Fixes Applied

1. **Image URL**: Strip webp query params and convert to .jpg
   - Sanity URL: `.../image.jpg?w=1200&fm=webp&q=90` 
   - Fixed: `.../image.jpg`

2. **Paper Options**: Use option 39 (No Bleed) to avoid aspect ratio errors
   - Error without option: "The aspect ratio of the image is not same as the ordered size"
   - Success with option 39: Order created successfully

3. **Data Format**:
   - subcategoryId: 103001 (Archival Matte Fine Art Paper)
   - width: 4, height: 6 (inches)
   - options: [39] (No Bleed)
   - imageUrl: clean jpg URL

## Sanity Paper Options Format

Format: `Name|subcategoryId|width|height`
- `Archival Matte 4×6|103001|4|6`
- `Archival Matte 6×9|103001|6|9`

## LumaPrints API Notes

- Category 103 = Fine Art Paper
- Subcategory IDs: 103001-103009 (different paper types)
- All accept sizes from 4x4 to 110x43 (or 110x59 for some)
- Option 39 = "No Bleed (Image goes to edge of paper)" - required to avoid aspect ratio validation
