"""Remove Custom Field rows that duplicate native Whatsapp Broadcast Queue DocFields."""

import frappe


def execute():
	doctype = "Whatsapp Broadcast Queue"
	native_fieldnames = {
		row.fieldname
		for row in frappe.get_all(
			"DocField",
			filters={"parent": doctype},
			fields=["fieldname"],
		)
	}
	if not native_fieldnames:
		return

	for cf_name in frappe.get_all(
		"Custom Field",
		filters={"dt": doctype, "fieldname": ["in", list(native_fieldnames)]},
		pluck="name",
	):
		frappe.delete_doc("Custom Field", cf_name, force=1, ignore_permissions=True)

	frappe.clear_cache(doctype=doctype)
