# Fixtures

Hand-built input batches with expected properties. Each fixture is one JSON
file shaped like this (all dates are relative so fixtures never go stale):

    {
      "name": "kebab-name",
      "description": "what this fixture stresses",
      "context": {
        "projects": [{ "id": "proj-x", "label": "Project X", "description": "..." }],
        "org_context": "one paragraph or null"
      },
      "existing_themes": [
        { "id": "theme-id", "label": "...", "discipline": "...", "lane": "horizon",
          "heat": 0.5, "mastery": "unread", "reads": 0, "days_since_update": 3 }
      ],
      "state": { "parked": [], "notes": [], "signals": [] },
      "excluded_ids": ["ids the reader handled outside state.parked, e.g. outbox parks the sweep has not applied; joined with read items and state parks into the exclusion set"],
      "items": [
        { "id": "sig-1", "title": "...", "source": "Feed Name", "days_ago": 1,
          "snippet": "...", "read": false, "topics": [], "url": "https://example.com/x" }
      ],
      "expect": {
        "lede_not_in": ["ids the lede must NOT cite"],
        "start_here_not_in": ["ids no start_here entry may cite"],
        "lede_in": ["at least one of these ids must be in lede.item_ids"],
        "cited_somewhere": ["ids that must be cited by some section"],
        "prominent_cites_any": ["one of these is cited by the lede OR an emerging card; use this for signal-must-surface tests, since leading with the signal is the strongest outcome"],
        "emerging_cites_any": ["strict variant: an emerging CARD cites one of these; only when card placement itself is under test"],
        "min_horizon_emerging": 1,
        "max_themes": 8,
        "notes": "human-readable intent"
      }
    }

Every `expect` key is optional except `notes`; the runner applies the ones
present. Items should read like real articles: titles with substance,
snippets with the facts the editor is allowed to cite. Keep 8 to 20 items
per fixture so a run stays cheap.

The golden set (../golden/golden.json) records, per fixture, the judged
score floors a healthy manifold should clear; the runner flags regressions.
