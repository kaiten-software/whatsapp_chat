# Graph Report - whatsapp_chat  (2026-06-16)

## Corpus Check
- 59 files · ~22,861 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 241 nodes · 343 edges · 32 communities (30 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `48f393e9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]

## God Nodes (most connected - your core abstractions)
1. `WhatsAppChat` - 55 edges
2. `_require_whatsapp_chat_access()` - 21 edges
3. `_require_whatsapp_chat_access()` - 21 edges
4. `_ensure_lead_scope_access()` - 17 edges
5. `_ensure_lead_scope_access()` - 17 edges
6. `send_template()` - 9 edges
7. `send_template()` - 9 edges
8. `_normalize_media_url()` - 5 edges
9. `get_messages()` - 5 edges
10. `get_ai_status()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `send_template()` --calls--> `_require_whatsapp_chat_access()`  [EXTRACTED]
  whatsapp_chat/api.py → whatsapp_chat/api.py  _Bridges community 2 → community 5_

## Import Cycles
- None detected.

## Communities (32 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (56): add_lead_tag(), assign_lead(), _build_public_file_url(), _can_view_all_leads(), delete_tag(), _ensure_lead_scope_access(), _extract_media_url(), get_ai_status() (+48 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (44): add_lead_tag(), assign_lead(), _can_view_all_leads(), delete_tag(), _ensure_lead_scope_access(), get_ai_status(), get_all_lead_tags(), get_assignable_users() (+36 more)

### Community 3 - "Community 3"
Cohesion: 0.10
Nodes (13): IntegrationTestAppMessageEvents, Integration tests for AppMessageEvents. 	Use this class for testing interactions, IntegrationTestCase, IntegrationTestMetaWhatsappTemplates, Integration tests for MetaWhatsappTemplates. 	Use this class for testing interac, IntegrationTestWhatsappBroadcastQueue, Integration tests for WhatsappBroadcastQueue. 	Use this class for testing intera, IntegrationTestWhatsAppAccess (+5 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (10): AppMessageEvents, Document, MetaWhatsappTemplates, WhatsappBroadcastQueue, WhatsAppAccess, WhatsAppAccess, WhatsappEventsChildTables, WhatsAppSettings (+2 more)

### Community 5 - "Community 5"
Cohesion: 0.20
Nodes (12): _build_public_file_url(), _extract_media_url(), _normalize_media_filename(), _normalize_media_url(), Normalize media URL/path/filename to a usable absolute URL for chat., Replace template placeholders like {{name}} / {{1}} with values., Extract first media URL from text, if any., Send a WhatsApp template message via Twilio. (+4 more)

### Community 6 - "Community 6"
Cohesion: 0.60
Nodes (4): execute(), _migrate_child_rows(), Change custom_events on Whatsapp Broadcast Queue from Table to Link., _update_docfield()

## Knowledge Gaps
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `_require_whatsapp_chat_access()` connect `Community 2` to `Community 5`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `Enforce lead scope access for WhatsApp Chat.      - System Manager / Administrat`, `Return only the last file name from URL/path input.`, `Build a public /files URL for current site.` to the rest of the system?**
  _59 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06328320802005012 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06233766233766234 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08080808080808081 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._