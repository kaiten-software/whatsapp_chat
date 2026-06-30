"""Change Meta Whatsapp Templates.message_id from Password to Data."""

import frappe
from frappe.utils.password import get_decrypted_password, remove_encrypted_password


def execute():
	doctype = "Meta Whatsapp Templates"
	fieldname = "message_id"

	for name in frappe.get_all(doctype, pluck="name"):
		value = get_decrypted_password(doctype, name, fieldname, raise_exception=False)
		if not value:
			continue
		frappe.db.set_value(doctype, name, fieldname, value, update_modified=False)
		remove_encrypted_password(doctype, name, fieldname)

	if frappe.db.get_value(
		"DocField", {"parent": doctype, "fieldname": fieldname}, "fieldtype"
	) != "Data":
		frappe.db.set_value(
			"DocField",
			{"parent": doctype, "fieldname": fieldname},
			"fieldtype",
			"Data",
			update_modified=False,
		)
		frappe.reload_doc("whatsapp_chat", "doctype", "meta_whatsapp_templates")
		frappe.clear_cache(doctype=doctype)
