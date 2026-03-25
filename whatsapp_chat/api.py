import json

import frappe
from frappe import _


@frappe.whitelist()
def get_leads(search=None):
    """
    Fetch leads with last message info and unread counts.
    Filtered by assignment — users see only their assigned leads,
    System Manager / Administrator sees all.
    """
    user = frappe.session.user
    roles = frappe.get_roles(user)
    is_admin = "System Manager" in roles or "Administrator" in roles or user == "Administrator"

    conditions = ""
    values = {}

    # Show leads that have a mobile number OR have message history
    conditions += """ AND (
        (l.mobile_no IS NOT NULL AND l.mobile_no != '')
        OR EXISTS (
            SELECT 1 FROM `tabLead Message Log` ml
            WHERE ml.parent = l.name AND ml.parentfield = 'custom_message_log'
        )
    )"""

    if search:
        conditions += (
            " AND (l.lead_name LIKE %(search)s"
            " OR l.mobile_no LIKE %(search)s"
            " OR l.name LIKE %(search)s)"
        )
        values["search"] = f"%{search}%"

    if not is_admin:
        conditions += """ AND l.name IN (
            SELECT reference_name FROM `tabToDo`
            WHERE reference_type = 'Lead'
            AND allocated_to = %(user)s
            AND status != 'Cancelled'
        )"""
        values["user"] = user

    leads = frappe.db.sql(
        """
        SELECT
            l.name,
            l.lead_name,
            l.mobile_no,
            l.custom_message_status,
            l.custom_ai_chat_onoff,
            l.custom_last_message_time,
            l.image,
            l._liked_by,
            (
                SELECT COUNT(*)
                FROM `tabLead Message Log` m
                WHERE m.parent = l.name
                AND m.parentfield = 'custom_message_log'
                AND m.message_from = 'Customer'
                AND m.agent_read_at IS NULL
            ) AS unread_count,
            (
                SELECT m2.message
                FROM `tabLead Message Log` m2
                WHERE m2.parent = l.name
                AND m2.parentfield = 'custom_message_log'
                ORDER BY m2.message_origin_time DESC
                LIMIT 1
            ) AS last_message,
            (
                SELECT m3.message_from
                FROM `tabLead Message Log` m3
                WHERE m3.parent = l.name
                AND m3.parentfield = 'custom_message_log'
                ORDER BY m3.message_origin_time DESC
                LIMIT 1
            ) AS last_message_from,
            (
                SELECT m4.message_origin_time
                FROM `tabLead Message Log` m4
                WHERE m4.parent = l.name
                AND m4.parentfield = 'custom_message_log'
                AND m4.message_from = 'Customer'
                ORDER BY m4.message_origin_time DESC
                LIMIT 1
            ) AS last_customer_message_time
        FROM `tabLead` l
        WHERE 1=1 {conditions}
        ORDER BY
            COALESCE(l.custom_last_message_time, '1970-01-01') DESC
        LIMIT 100
        """.format(conditions=conditions),
        values,
        as_dict=True,
    )

    # Convert datetime objects to strings for JSON serialization
    for lead in leads:
        if lead.get("custom_last_message_time"):
            lead["last_message_time"] = str(lead["custom_last_message_time"])
        else:
            lead["last_message_time"] = None
        if lead.get("last_customer_message_time"):
            lead["last_customer_message_time"] = str(lead["last_customer_message_time"])
        else:
            lead["last_customer_message_time"] = None

    # ── Attach tags (built-in Frappe Tag Link) ──────────────────────
    lead_names = [l["name"] for l in leads]
    tags_map = {}
    if lead_names:
        tag_links = frappe.db.sql(
            """
            SELECT document_name, tag
            FROM `tabTag Link`
            WHERE document_type = 'Lead'
            AND document_name IN %s
            """,
            (lead_names,),
            as_dict=True,
        )
        for tl in tag_links:
            tags_map.setdefault(tl["document_name"], []).append(tl["tag"])

    # ── Attach favorite status (built-in _liked_by) ─────────────────
    for lead in leads:
        lead["tags"] = tags_map.get(lead["name"], [])
        liked_by = lead.get("_liked_by") or ""
        # _liked_by is stored as JSON string list
        try:
            liked_by_list = json.loads(liked_by) if liked_by else []
            lead["is_favorite"] = user in liked_by_list
        except (json.JSONDecodeError, TypeError):
            # Fallback for plain string format (older Frappe versions)
            lead["is_favorite"] = user in liked_by.split("\n") if liked_by else False

    return leads


@frappe.whitelist()
def get_messages(lead):
    """Get all messages for a specific lead, ordered chronologically."""
    frappe.has_permission("Lead", doc=lead, throw=True)

    messages = frappe.db.sql(
        """
        SELECT
            name, message, message_from, message_origin_time,
            status, attachment, template_id, message_id,
            delivered_at, client_read_at, agent_read_at,
            failed_code, failed_reason, message_read_by_agent
        FROM `tabLead Message Log`
        WHERE parent = %s AND parentfield = 'custom_message_log'
        ORDER BY STR_TO_DATE(message_origin_time, '%%Y-%%m-%%d %%H:%%i:%%s') ASC,
                 idx ASC
        """,
        lead,
        as_dict=True,
    )

    # Convert datetime fields to strings
    for msg in messages:
        for field in [
            "message_origin_time",
            "delivered_at",
            "client_read_at",
            "agent_read_at",
        ]:
            if msg.get(field):
                msg[field] = str(msg[field])

    # Get last customer message time for session window calculation
    last_customer = frappe.db.sql(
        """
        SELECT message_origin_time
        FROM `tabLead Message Log`
        WHERE parent = %s AND parentfield = 'custom_message_log'
        AND message_from = 'Customer'
        ORDER BY STR_TO_DATE(message_origin_time, '%%Y-%%m-%%d %%H:%%i:%%s') DESC
        LIMIT 1
        """,
        lead,
        as_dict=True,
    )
    last_customer_time = str(last_customer[0].message_origin_time) if last_customer else None

    return {
        "messages": messages,
        "last_customer_message_time": last_customer_time,
    }


@frappe.whitelist()
def send_message(lead, message):
    """Send a WhatsApp message via Twilio and log it on the Lead."""
    frappe.has_permission("Lead", doc=lead, ptype="write", throw=True)

    lead_doc = frappe.get_doc("Lead", lead)
    mobile_no = lead_doc.mobile_no

    if not mobile_no:
        frappe.throw(_("This lead does not have a mobile number."))

    # Check 24-hour customer service window
    last_customer = frappe.db.sql(
        """
        SELECT message_origin_time
        FROM `tabLead Message Log`
        WHERE parent = %s AND parentfield = 'custom_message_log'
        AND message_from = 'Customer'
        ORDER BY STR_TO_DATE(message_origin_time, '%%Y-%%m-%%d %%H:%%i:%%s') DESC
        LIMIT 1
        """,
        lead,
        as_dict=True,
    )
    if last_customer:
        from datetime import datetime, timedelta
        try:
            last_time = datetime.strptime(str(last_customer[0].message_origin_time), "%Y-%m-%d %H:%M:%S")
        except ValueError:
            last_time = datetime.strptime(str(last_customer[0].message_origin_time)[:19], "%Y-%m-%d %H:%M:%S")
        if datetime.now() - last_time > timedelta(hours=24):
            frappe.throw(
                _("Customer service window has expired (24h since last customer message). "
                  "Please send a template message instead.")
            )
    else:
        frappe.throw(
            _("No customer messages found. You must send a template message first "
              "to initiate the conversation.")
        )

    settings = frappe.get_single("WhatsApp Settings")
    if not settings.twilio_account_sid or not settings.twilio_whatsapp_number:
        frappe.throw(
            _("Please configure Twilio credentials in WhatsApp Settings first.")
        )

    try:
        from twilio.rest import Client
    except ImportError:
        frappe.throw(
            _(
                "Twilio package is not installed. "
                "Run: bench pip install twilio"
            )
        )

    client = Client(
        settings.twilio_account_sid,
        settings.get_password("twilio_auth_token"),
    )

    # Ensure E.164 format — numbers stored as 918302070683 (country code without +)
    to_number = mobile_no.strip()
    if not to_number.startswith("+"):
        to_number = f"+{to_number}"

    from_number = settings.twilio_whatsapp_number.strip()
    if not from_number.startswith("+"):
        from_number = f"+{from_number}"

    try:
        twilio_msg = client.messages.create(
            body=message,
            from_=f"whatsapp:{from_number}",
            to=f"whatsapp:{to_number}",
        )
    except Exception as e:
        frappe.throw(_("Failed to send WhatsApp message: {0}").format(str(e)))

    # Log the message in the child table
    now = frappe.utils.now_datetime()
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")
    lead_doc.append(
        "custom_message_log",
        {
            "message": message,
            "message_from": "Agent(manual)",
            "message_origin_time": now_str,
            "message_id": twilio_msg.sid,
            "status": "sent",
            "last_updated_at": now,
        },
    )
    lead_doc.custom_last_message_time = now
    lead_doc.flags.from_whatsapp_chat = True  # Prevent duplicate realtime publish
    lead_doc.save(ignore_permissions=True)
    frappe.db.commit()

    # Publish realtime event
    frappe.publish_realtime(
        "whatsapp_message",
        {
            "lead": lead,
            "lead_name": lead_doc.lead_name,
            "message": message,
            "message_from": "Agent(manual)",
            "timestamp": str(now),
        },
    )

    return {"status": "sent", "message_sid": twilio_msg.sid}


@frappe.whitelist()
def send_template(lead, template_name, variables=None):
    """Send a WhatsApp template message via Twilio."""
    frappe.has_permission("Lead", doc=lead, ptype="write", throw=True)

    lead_doc = frappe.get_doc("Lead", lead)
    mobile_no = lead_doc.mobile_no

    if not mobile_no:
        frappe.throw(_("This lead does not have a mobile number."))

    template = frappe.get_doc("WhatsApp Template", template_name)
    settings = frappe.get_single("WhatsApp Settings")

    if not settings.twilio_account_sid:
        frappe.throw(_("Please configure WhatsApp Settings first."))

    try:
        from twilio.rest import Client
    except ImportError:
        frappe.throw(_("Twilio package not installed. Run: bench pip install twilio"))

    client = Client(
        settings.twilio_account_sid,
        settings.get_password("twilio_auth_token"),
    )

    # Numbers stored as 918302070683 (country code without +)
    to_number = mobile_no.strip()
    if not to_number.startswith("+"):
        to_number = f"+{to_number}"

    from_number = settings.twilio_whatsapp_number.strip()
    if not from_number.startswith("+"):
        from_number = f"+{from_number}"

    msg_kwargs = {
        "from_": f"whatsapp:{from_number}",
        "to": f"whatsapp:{to_number}",
    }

    # Parse variables
    vars_dict = {}
    if variables:
        vars_dict = json.loads(variables) if isinstance(variables, str) else variables

    # Use Content SID if available, otherwise send body as regular message
    if template.template_sid:
        msg_kwargs["content_sid"] = template.template_sid
        if vars_dict:
            msg_kwargs["content_variables"] = json.dumps(vars_dict)
    else:
        body = template.body or template.template_name
        for key, value in vars_dict.items():
            body = body.replace("{{" + str(key) + "}}", str(value))
        msg_kwargs["body"] = body

    try:
        twilio_msg = client.messages.create(**msg_kwargs)
    except Exception as e:
        frappe.throw(_("Failed to send template message: {0}").format(str(e)))

    # Log
    now = frappe.utils.now_datetime()
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")
    lead_doc.append(
        "custom_message_log",
        {
            "message": template.body or template.template_name,
            "message_from": "Agent(manual)",
            "message_origin_time": now_str,
            "message_id": twilio_msg.sid,
            "template_id": template.template_sid or template.template_name,
            "status": "sent",
            "last_updated_at": now,
        },
    )
    lead_doc.custom_last_message_time = now
    lead_doc.flags.from_whatsapp_chat = True
    lead_doc.save(ignore_permissions=True)
    frappe.db.commit()

    frappe.publish_realtime(
        "whatsapp_message",
        {
            "lead": lead,
            "lead_name": lead_doc.lead_name,
            "message": template.body or template.template_name,
            "message_from": "Agent(manual)",
            "timestamp": str(now),
        },
    )

    return {"status": "sent", "message_sid": twilio_msg.sid}


@frappe.whitelist()
def get_templates():
    """Get all WhatsApp templates for the template picker."""
    return frappe.get_all(
        "WhatsApp Template",
        fields=["name", "template_name", "template_sid", "body", "variables", "language"],
        order_by="template_name asc",
    )


@frappe.whitelist()
def toggle_ai_chat(lead):
    """Toggle the AI chat on/off for a lead. Returns the new status.
    Statuses: On, Pending, Off, Off(Manual)
    Toggling from On/Pending → Off(Manual), from Off/Off(Manual) → On
    """
    frappe.has_permission("Lead", doc=lead, ptype="write", throw=True)

    lead_doc = frappe.get_doc("Lead", lead)
    current = (lead_doc.custom_ai_chat_onoff or "Off").strip()
    # If currently active (On or Pending), manually turn off
    if current in ("On", "Pending"):
        new_status = "Off(Manual)"
    else:
        new_status = "On"
    lead_doc.custom_ai_chat_onoff = new_status
    lead_doc.flags.from_whatsapp_chat = True
    lead_doc.save(ignore_permissions=True)
    frappe.db.commit()

    return new_status


@frappe.whitelist()
def get_ai_status(lead):
    """Get the current AI chat status and next response time for a lead.
    Uses custom_wait_time (hours) inside CSW, custom_wait_time_ocsw (days) outside CSW.
    """
    frappe.has_permission("Lead", doc=lead, throw=True)

    lead_doc = frappe.get_doc("Lead", lead)
    status = (lead_doc.custom_ai_chat_onoff or "Off").strip()

    result = {"status": status, "next_response_at": None, "wait_context": None}

    if status not in ("On", "Pending"):
        return result

    from datetime import datetime, timedelta

    # Determine if inside CSW (24h from last customer message)
    last_customer = frappe.db.sql(
        """
        SELECT message_origin_time
        FROM `tabLead Message Log`
        WHERE parent = %s AND parentfield = 'custom_message_log'
        AND message_from = 'Customer'
        ORDER BY STR_TO_DATE(message_origin_time, '%%Y-%%m-%%d %%H:%%i:%%s') DESC
        LIMIT 1
        """,
        lead,
        as_dict=True,
    )

    inside_csw = False
    if last_customer and last_customer[0].message_origin_time:
        try:
            last_cust_time = datetime.strptime(
                str(last_customer[0].message_origin_time)[:19], "%Y-%m-%d %H:%M:%S"
            )
            inside_csw = (datetime.now() - last_cust_time) < timedelta(hours=24)
        except (ValueError, TypeError):
            pass

    # Pick the right wait time field and unit
    if inside_csw:
        wait_str = (lead_doc.custom_wait_time or "").strip()
        try:
            wait_value = float(wait_str)
        except (ValueError, TypeError):
            wait_value = 0
        wait_delta = timedelta(hours=wait_value) if wait_value > 0 else None
        result["wait_context"] = "csw"  # inside customer service window
    else:
        wait_str = (lead_doc.custom_wait_time_ocsw or "").strip()
        try:
            wait_value = float(wait_str)
        except (ValueError, TypeError):
            wait_value = 0
        wait_delta = timedelta(days=wait_value) if wait_value > 0 else None
        result["wait_context"] = "ocsw"  # outside customer service window

    if not wait_delta:
        return result

    # Find the last outgoing message to calculate countdown from
    last_outgoing = frappe.db.sql(
        """
        SELECT message_origin_time
        FROM `tabLead Message Log`
        WHERE parent = %s AND parentfield = 'custom_message_log'
        AND message_from IN ('Agent(ai)', 'Agent(manual)')
        ORDER BY STR_TO_DATE(message_origin_time, '%%Y-%%m-%%d %%H:%%i:%%s') DESC
        LIMIT 1
        """,
        lead,
        as_dict=True,
    )
    if last_outgoing and last_outgoing[0].message_origin_time:
        try:
            last_time = datetime.strptime(
                str(last_outgoing[0].message_origin_time)[:19], "%Y-%m-%d %H:%M:%S"
            )
            next_at = last_time + wait_delta
            result["next_response_at"] = next_at.strftime("%Y-%m-%d %H:%M:%S")
        except (ValueError, TypeError):
            pass

    return result


@frappe.whitelist()
def pause_ai_chat(lead, minutes=15):
    """Pause AI chat by setting status to Off(Manual).
    The n8n workflow is expected to re-enable it after the pause period,
    or when the next customer message arrives.
    """
    frappe.has_permission("Lead", doc=lead, ptype="write", throw=True)

    lead_doc = frappe.get_doc("Lead", lead)
    current = (lead_doc.custom_ai_chat_onoff or "Off").strip()

    # Only pause if AI is currently active
    if current in ("On", "Pending"):
        lead_doc.custom_ai_chat_onoff = "Off(Manual)"
        lead_doc.flags.from_whatsapp_chat = True
        lead_doc.save(ignore_permissions=True)
        frappe.db.commit()
        return True

    return False


@frappe.whitelist()
def mark_read(lead):
    """Mark all incoming messages as read by the agent."""
    frappe.has_permission("Lead", doc=lead, throw=True)

    now = frappe.utils.now_datetime()
    frappe.db.sql(
        """
        UPDATE `tabLead Message Log`
        SET agent_read_at = %s, message_read_by_agent = 1
        WHERE parent = %s
        AND parentfield = 'custom_message_log'
        AND message_from = 'Customer'
        AND agent_read_at IS NULL
        """,
        (now, lead),
    )
    frappe.db.commit()


@frappe.whitelist()
def get_assignees(lead):
    """Get current assignees for a lead (via ToDo)."""
    frappe.has_permission("Lead", doc=lead, throw=True)

    assignees = frappe.db.sql(
        """
        SELECT t.allocated_to as user, u.full_name, u.user_image
        FROM `tabToDo` t
        LEFT JOIN `tabUser` u ON u.name = t.allocated_to
        WHERE t.reference_type = 'Lead'
        AND t.reference_name = %s
        AND t.status != 'Cancelled'
        ORDER BY t.creation
        """,
        lead,
        as_dict=True,
    )
    return assignees


@frappe.whitelist()
def get_assignable_users():
    """Get all enabled users that can be assigned to leads."""
    users = frappe.db.sql(
        """
        SELECT u.name as user, u.full_name, u.user_image
        FROM `tabUser` u
        WHERE u.enabled = 1
        AND u.user_type = 'System User'
        AND u.name NOT IN ('Guest', 'Administrator')
        ORDER BY u.full_name
        """,
        as_dict=True,
    )
    return users


@frappe.whitelist()
def assign_lead(lead, user):
    """Assign a lead to a user. Only System Manager can assign."""
    caller = frappe.session.user
    roles = frappe.get_roles(caller)
    if "System Manager" not in roles and caller != "Administrator":
        frappe.throw(_("Only administrators/managers can assign leads."), frappe.PermissionError)

    frappe.has_permission("Lead", doc=lead, ptype="write", throw=True)

    # Check if already assigned
    existing = frappe.db.exists("ToDo", {
        "reference_type": "Lead",
        "reference_name": lead,
        "allocated_to": user,
        "status": ("!=", "Cancelled"),
    })
    if existing:
        return {"ok": True, "message": "Already assigned"}

    todo = frappe.get_doc({
        "doctype": "ToDo",
        "reference_type": "Lead",
        "reference_name": lead,
        "allocated_to": user,
        "assigned_by": caller,
        "status": "Open",
        "priority": "Medium",
        "description": _("Lead {0} assigned via WhatsApp Chat").format(lead),
    })
    todo.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"ok": True, "message": "Assigned"}


@frappe.whitelist()
def unassign_lead(lead, user):
    """Remove assignment of a lead from a user. Only System Manager can unassign."""
    caller = frappe.session.user
    roles = frappe.get_roles(caller)
    if "System Manager" not in roles and caller != "Administrator":
        frappe.throw(_("Only administrators/managers can unassign leads."), frappe.PermissionError)

    frappe.has_permission("Lead", doc=lead, ptype="write", throw=True)

    todos = frappe.get_all("ToDo", filters={
        "reference_type": "Lead",
        "reference_name": lead,
        "allocated_to": user,
        "status": ("!=", "Cancelled"),
    })
    for t in todos:
        frappe.db.set_value("ToDo", t.name, "status", "Cancelled")
    frappe.db.commit()
    return {"ok": True, "message": "Unassigned"}


def handle_lead_update(doc, method):
    """
    Hook: fires on every Lead save.
    Publishes a realtime event so the WhatsApp Chat page can live-update.
    Skips if the save was triggered from our own send_message/send_template
    (to avoid duplicate events).
    """
    if getattr(doc.flags, "from_whatsapp_chat", False):
        return

    if doc.custom_message_log:
        latest = doc.custom_message_log[-1]
        frappe.publish_realtime(
            "whatsapp_message",
            {
                "lead": doc.name,
                "lead_name": doc.lead_name,
                "message": latest.message,
                "message_from": latest.message_from,
                "timestamp": str(latest.message_origin_time) if latest.message_origin_time else "",
                "status": latest.status,
            },
        )


# ═══════════════════════════════════════════════════════════════════════
#  Tags  (uses built-in Frappe Tag Link)
# ═══════════════════════════════════════════════════════════════════════

# WhatsApp Business prebuilt labels
PREBUILT_TAGS = [
    "New customer",
    "New order",
    "Pending payment",
    "Paid",
    "Order complete",
    "Important",
]


@frappe.whitelist()
def get_lead_tags(lead):
    """Get all tags for a specific lead using Frappe's built-in Tag Link."""
    frappe.has_permission("Lead", doc=lead, throw=True)

    tags = frappe.db.sql(
        """
        SELECT tag FROM `tabTag Link`
        WHERE document_type = 'Lead' AND document_name = %s
        ORDER BY tag
        """,
        lead,
        as_dict=True,
    )
    return [t["tag"] for t in tags]


@frappe.whitelist()
def add_lead_tag(lead, tag):
    """Add a tag to a lead using Frappe's built-in tag system."""
    frappe.has_permission("Lead", doc=lead, ptype="write", throw=True)

    tag = (tag or "").strip()
    if not tag:
        frappe.throw(_("Tag cannot be empty."))

    # Use Frappe's built-in add_tag
    from frappe.desk.doctype.tag.tag import add_tag
    add_tag(tag, "Lead", lead)
    frappe.db.commit()
    return {"ok": True}


@frappe.whitelist()
def remove_lead_tag(lead, tag):
    """Remove a tag from a lead using Frappe's built-in tag system."""
    frappe.has_permission("Lead", doc=lead, ptype="write", throw=True)

    from frappe.desk.doctype.tag.tag import remove_tag
    remove_tag(tag, "Lead", lead)
    frappe.db.commit()
    return {"ok": True}


@frappe.whitelist()
def get_all_lead_tags():
    """Get all unique tags used on any Lead, plus the prebuilt WhatsApp Business tags."""
    existing = frappe.db.sql(
        """
        SELECT DISTINCT tag FROM `tabTag Link`
        WHERE document_type = 'Lead'
        ORDER BY tag
        """,
        as_dict=True,
    )
    existing_tags = [t["tag"] for t in existing]

    # Merge prebuilt tags (ensure they always show as suggestions)
    all_tags = list(existing_tags)
    for pt in PREBUILT_TAGS:
        if pt not in all_tags:
            all_tags.append(pt)

    return {
        "tags": sorted(all_tags, key=str.lower),
        "prebuilt": PREBUILT_TAGS,
    }


@frappe.whitelist()
def delete_tag(tag):
    """Delete a tag globally — removes it from ALL leads. Requires System Manager."""
    caller = frappe.session.user
    roles = frappe.get_roles(caller)
    if "System Manager" not in roles and caller != "Administrator":
        frappe.throw(_("Only administrators can delete tags globally."), frappe.PermissionError)

    tag = (tag or "").strip()
    if not tag:
        frappe.throw(_("Tag cannot be empty."))

    # Remove the tag from all leads
    frappe.db.sql(
        """
        DELETE FROM `tabTag Link`
        WHERE document_type = 'Lead' AND tag = %s
        """,
        tag,
    )
    frappe.db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════
#  Favorites  (uses built-in Frappe _liked_by)
# ═══════════════════════════════════════════════════════════════════════

@frappe.whitelist()
def toggle_lead_favorite(lead):
    """Toggle the current user's favorite (like) on a lead."""
    frappe.has_permission("Lead", doc=lead, throw=True)

    # Check current state first
    liked_by_raw = frappe.db.get_value("Lead", lead, "_liked_by") or ""
    try:
        liked_by_list = json.loads(liked_by_raw) if liked_by_raw else []
    except (json.JSONDecodeError, TypeError):
        liked_by_list = []

    currently_liked = frappe.session.user in liked_by_list

    # toggle_like requires add="Yes" to add, otherwise it removes
    from frappe.desk.like import toggle_like
    if currently_liked:
        toggle_like("Lead", lead, add="No")
    else:
        toggle_like("Lead", lead, add="Yes")

    # Return new state
    liked_by = frappe.db.get_value("Lead", lead, "_liked_by") or ""
    try:
        liked_by_list = json.loads(liked_by) if liked_by else []
        is_favorite = frappe.session.user in liked_by_list
    except (json.JSONDecodeError, TypeError):
        is_favorite = frappe.session.user in liked_by.split("\n") if liked_by else False

    return {"is_favorite": is_favorite}
