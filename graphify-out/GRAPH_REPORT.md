# Graph Report - .  (2026-06-16)

## Corpus Check
- Corpus is ~22,761 words - fits in a single context window. You may not need a graph.

## Summary
- 241 nodes · 341 edges · 31 communities (29 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Backend API Layer|Backend API Layer]]
- [[_COMMUNITY_Nested API Module|Nested API Module]]
- [[_COMMUNITY_WhatsApp Chat UI|WhatsApp Chat UI]]
- [[_COMMUNITY_DocType Integration Tests|DocType Integration Tests]]
- [[_COMMUNITY_Frappe DocType Models|Frappe DocType Models]]
- [[_COMMUNITY_App Bootstrap Config|App Bootstrap Config]]
- [[_COMMUNITY_Database Patch Script|Database Patch Script]]

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
- `twilio` --conceptually_related_to--> `WhatsApp Chat`  [INFERRED]
  requirements.txt → whatsapp_chat/modules.txt
- `remove_wbq_duplicate_custom_fields` --conceptually_related_to--> `WhatsApp Chat`  [INFERRED]
  whatsapp_chat/patches.txt → whatsapp_chat/modules.txt

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **WhatsApp Chat Frappe App Bootstrap** — whatsapp_chat_modules_whatsapp_chat, whatsapp_chat_patches_post_model_sync, requirements_twilio [INFERRED 0.75]

## Communities (31 total, 2 thin omitted)

### Community 0 - "Backend API Layer"
Cohesion: 0.06
Nodes (56): add_lead_tag(), assign_lead(), _build_public_file_url(), _can_view_all_leads(), delete_tag(), _ensure_lead_scope_access(), _extract_media_url(), get_ai_status() (+48 more)

### Community 1 - "Nested API Module"
Cohesion: 0.06
Nodes (56): add_lead_tag(), assign_lead(), _build_public_file_url(), _can_view_all_leads(), delete_tag(), _ensure_lead_scope_access(), _extract_media_url(), get_ai_status() (+48 more)

### Community 3 - "DocType Integration Tests"
Cohesion: 0.10
Nodes (13): IntegrationTestAppMessageEvents, Integration tests for AppMessageEvents. 	Use this class for testing interactions, IntegrationTestCase, IntegrationTestMetaWhatsappTemplates, Integration tests for MetaWhatsappTemplates. 	Use this class for testing interac, IntegrationTestWhatsappBroadcastQueue, Integration tests for WhatsappBroadcastQueue. 	Use this class for testing intera, IntegrationTestWhatsAppAccess (+5 more)

### Community 4 - "Frappe DocType Models"
Cohesion: 0.11
Nodes (10): AppMessageEvents, Document, MetaWhatsappTemplates, WhatsappBroadcastQueue, WhatsAppAccess, WhatsAppAccess, WhatsappEventsChildTables, WhatsAppSettings (+2 more)

### Community 5 - "App Bootstrap Config"
Cohesion: 0.40
Nodes (5): twilio, WhatsApp Chat, post_model_sync, pre_model_sync, remove_wbq_duplicate_custom_fields

## Knowledge Gaps
- **2 isolated node(s):** `twilio`, `pre_model_sync`
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `Enforce lead scope access for WhatsApp Chat.      - System Manager / Administrat`, `Return only the last file name from URL/path input.`, `Build a public /files URL for current site.` to the rest of the system?**
  _60 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Backend API Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.06328320802005012 - nodes in this community are weakly interconnected._
- **Should `Nested API Module` be split into smaller, more focused modules?**
  _Cohesion score 0.06328320802005012 - nodes in this community are weakly interconnected._
- **Should `WhatsApp Chat UI` be split into smaller, more focused modules?**
  _Cohesion score 0.06233766233766234 - nodes in this community are weakly interconnected._
- **Should `DocType Integration Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Frappe DocType Models` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._