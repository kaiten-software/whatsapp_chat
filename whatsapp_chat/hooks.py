app_name = "koristu_chat"
app_title = "Koristu Chat"
app_publisher = "Kaiten Software"
app_description = "WhatsApp-like chat interface for ERPNext CRM Leads"
app_email = "hello@kaitensoftware.com"
app_license = "MIT"
app_version = "0.0.2"

# Document Events
doc_events = {
    "Lead": {
        "on_update": "whatsapp_chat.api.handle_lead_update"
    }
}

# Scheduled Tasks
# scheduler_events = {}

# Permissions evaluated in scripted ways
# permission_query_conditions = {}
# has_permission = {}

# Website
website_route_rules = []

# Fixtures
# Export DocType definitions and the desk Page so they can be re-used (e.g. in ai_chat)
fixtures = [
    
    {"dt": "DocType", "filters": [["module", "=", "WhatsApp Chat"]]},
    {"dt": "Custom Field", "filters": [["module", "=", "WhatsApp Chat"]]},
    {
        "doctype": "Page",
        # Actual page name uses a dash; keep filter aligned so export works
        "filters": [["name", "=", "whatsapp-chat"]],
    },
]
