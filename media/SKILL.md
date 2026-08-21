---
name: media
description: Analyze, retrieve, generate, and send image or audio media through ToBe Media and Awareness Adapters.
---

# Media

Use MediaRef as the only Agent-visible media representation. Never place binary data, local paths, credentials, or provider download URLs in the conversation.

## Analyze media

1. Call `media_analyze` with one to eight inputs and an optional prompt.
2. Use multiple image inputs in one call when comparison or joint interpretation matters.
3. Inputs may be existing MediaRefs or workspace file paths. Prefer MediaRefs when available.
4. Treat the returned analysis as transient. The detailed result is not persisted.

## Select library media

1. Call `media_list` with the required kind.
2. Choose only a category and tag returned by the tool. Never invent library paths.
3. Construct the library MediaRef exactly as returned, then pass it to the target Adapter action through `awareness_interact.args.media`.

```json
{
  "media": {
    "type": "media_ref",
    "source": "library",
    "kind": "image",
    "category": "stickers",
    "tag": "happy",
    "description": "A happy sticker"
  }
}
```

## Generate media

1. Call `media_generate` with `kind`, an optional prompt, and up to four MediaRef references.
2. Supply a prompt when there are no references. References alone use the configured default generation prompt.
3. On success, keep the returned artifact MediaRef unchanged.
4. Pass that MediaRef to the target Adapter action through `awareness_interact.args.media`.
5. Generation success does not mean the environment received the media. The Adapter interaction result is the delivery receipt.
6. Reuse the same MediaRef when retrying delivery. Do not regenerate equivalent content.

## Boundaries

- Public Agent tools are exactly `media_list`, `media_analyze`, and `media_generate`.
- Image and audio analysis/generation are supported when their providers are enabled.
- Video and file remain reference/storage extension points and do not imply model support.
- Adapters never resolve MediaRefs directly. The Awareness Media Pipeline resolves them before Adapter delivery.
- If Media is unavailable, continue handling plain text normally.
