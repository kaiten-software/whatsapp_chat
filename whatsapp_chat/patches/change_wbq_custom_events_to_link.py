"""Change custom_events on Whatsapp Broadcast Queue from Table to Link."""

import frappe

DOCTYPE = "Whatsapp Broadcast Queue"
FIELD = "custom_events"
LINK_TO = "App Message Events"
CHILD_DOCTYPE = "Whatsapp Events Child Tables"


def execute():
	_update_docfield()
	frappe.clear_cache(doctype=DOCTYPE)
	frappe.db.updatedb(DOCTYPE)
	_migrate_child_rows()


def _migrate_child_rows():
	# ponytail: first child row wins when multiple event rows exist
	seen = set()
	for row in frappe.get_all(
		CHILD_DOCTYPE,
		filters={"parenttype": DOCTYPE, "parentfield": FIELD},
		fields=["parent", "event_name"],
		order_by="parent asc, idx asc",
	):
		if row.parent in seen or not row.event_name:
			continue
		seen.add(row.parent)
		frappe.db.set_value(DOCTYPE, row.parent, FIELD, row.event_name)

	frappe.db.delete(CHILD_DOCTYPE, {"parenttype": DOCTYPE, "parentfield": FIELD})


def _update_docfield():
	frappe.db.set_value(
		"DocField",
		{"parent": DOCTYPE, "fieldname": FIELD},
		{"fieldtype": "Link", "options": LINK_TO},
		update_modified=False,
	)
