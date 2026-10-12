# Canonical Import Identities

**Status:** Implemented | Optional private rules before import paths and metadata tags

## Overview
Curated author/series aliases and ASIN identities prevent provider spelling variations from creating duplicate library groups. Matching is exact; unknown names and edition labels remain distinct.

## Configuration
- `CANONICAL_IDENTITIES_FILE`: absolute path to a privately mounted UTF-8 JSON file; omitted disables normalization.
- Schema version `1`; maps `author_aliases` and `series_aliases` contain normalized aliases to canonical names.
- `books_by_asin`: optional exact identifiers with `authors` and `series: [{name, sequence}]`.
- `disabled_ambiguous_aliases: {author: [], series: []}` and `disabled_ambiguous_asins: []`: reject conflicting mappings.
- `strip_audiobook_format_labels`: optional boolean; removes only parenthesized `(Novel)`, `(Novels)`, `(Light Novel)` from audiobook titles/series. Meaningful editions and multipart labels remain.
- Invalid configured files fail imports before placement; private rules never enter public images or log output.

## Import Behavior
- Apply after provider enrichment, before audiobook/ebook folder and filename generation.
- Normalize author strings and series names used by audio tags and EPUB author/series metadata.
- Preserve narrators, translators, illustrators, ASINs, series indexes and content bytes.
- No retroactive library rewrite, fuzzy matching, or schema migration.

## Related
- [File organization](../phase3/file-organization.md)
