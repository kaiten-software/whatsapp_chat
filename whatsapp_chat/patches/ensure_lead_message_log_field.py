"""Ensure Lead.custom_message_log Table field exists for WhatsApp chat logging."""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
	if not frappe.db.exists("DocType", "Lead Message Log"):
		return

	if frappe.db.exists("Custom Field", {"dt": "Lead", "fieldname": "custom_message_log"}):
		return

	create_custom_fields(
		{
			"Lead": {
				"fieldname": "custom_message_log",
				"label": "Message Log",
				"fieldtype": "Table",
				"options": "Lead Message Log",
				"insert_after": "notes",
				"module": "WhatsApp Chat",
			}
		}
	)
