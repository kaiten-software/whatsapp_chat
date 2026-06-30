"""Set Meta Whatsapp Templates.message_id fieldtype to Data and reload doctype."""

import frappe


def execute():
	doctype = "Meta Whatsapp Templates"
	fieldname = "message_id"

	if frappe.db.get_value(
		"DocField", {"parent": doctype, "fieldname": fieldname}, "fieldtype"
	) == "Data":
		return

	frappe.db.set_value(
		"DocField",
		{"parent": doctype, "fieldname": fieldname},
		"fieldtype",
		"Data",
		update_modified=False,
	)
	frappe.reload_doc("whatsapp_chat", "doctype", "meta_whatsapp_templates")
	frappe.clear_cache(doctype=doctype)
