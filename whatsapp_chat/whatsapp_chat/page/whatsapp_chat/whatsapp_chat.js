frappe.pages["whatsapp-chat"].on_page_load = function (wrapper) {
    frappe.whatsapp_chat = new WhatsAppChat(wrapper);
};

frappe.pages["whatsapp-chat"].on_page_show = function () {
    if (frappe.whatsapp_chat) {
        frappe.whatsapp_chat.refresh();
    }
};

class WhatsAppChat {
    constructor(wrapper) {
        this.wrapper = wrapper;
        this.page = frappe.ui.make_app_page({
            parent: wrapper,
            title: "WhatsApp Chat",
            single_column: true,
        });

        // Full-screen layout: hide page head, remove padding
        $(wrapper).closest(".page-container").addClass("whatsapp-chat-page");

        this.current_lead = null;
        this.leads = [];
        this.search_timeout = null;
        this.poll_interval = null;
        this.session_window_open = false;
        this.last_customer_message_time = null;
        this.csw_filter = "all"; // 'all', 'open', 'closed', 'favorites'
        this.tag_filter = null; // null or tag string

        this.make();
    }

    make() {
        this.render_layout();
        this.fetch_leads();
        this.setup_realtime();
        this.setup_keyboard();
        this.start_polling();
    }

    refresh() {
        this.fetch_leads();
        if (this.current_lead) {
            this.fetch_messages();
        }
    }

    start_polling() {
        // Poll every 10 seconds for updates (fallback for realtime)
        if (this.poll_interval) clearInterval(this.poll_interval);
        this.poll_interval = setInterval(() => {
            this.fetch_leads(this.$container.find(".wa-search-input").val());
            if (this.current_lead) {
                this.fetch_messages();
                this.refresh_ai_status(this.current_lead);
            }
        }, 10000);
    }

    destroy() {
        if (this.poll_interval) clearInterval(this.poll_interval);
    }

    /* ───────────────────────── Layout ─────────────────────────── */

    render_layout() {
        this.page.body.html(`
            <div class="whatsapp-container">
                <div class="wa-sidebar">
                    <div class="wa-sidebar-header">
                        <h3>💬 WhatsApp</h3>
                    </div>
                    <div class="wa-search">
                        <input type="text"
                               class="wa-search-input"
                               placeholder="Search leads..." />
                    </div>
                    <div class="wa-filter-bar">
                        <button class="wa-filter-btn active" data-filter="all">All</button>
                        <button class="wa-filter-btn" data-filter="favorites">⭐ Favorites</button>
                        <button class="wa-filter-btn" data-filter="unread">Unread</button>
                        <button class="wa-filter-btn" data-filter="open">🪟 Open</button>
                        <button class="wa-filter-btn" data-filter="closed">🚪 Closed</button>
                    </div>
                    <div class="wa-tag-filter-bar" style="display:none;">
                        <span class="wa-tag-filter-label">Filtering by tag:</span>
                        <span class="wa-tag-filter-value"></span>
                        <button class="wa-tag-filter-clear" title="Clear tag filter">✕</button>
                    </div>
                    <div class="wa-contacts">
                        <div class="wa-loading">Loading leads</div>
                    </div>
                </div>
                <div class="wa-chat-area">
                    <div class="wa-empty">
                        <div>
                            <div style="font-size:48px;margin-bottom:24px;opacity:0.5">💬</div>
                            <h2>WhatsApp Chat</h2>
                            <p>Send and receive WhatsApp messages right from ERPNext.<br>
                               Select a lead from the left to start chatting.</p>
                        </div>
                    </div>
                </div>
            </div>
        `);

        this.$container = $(this.page.body).find(".whatsapp-container");
        this.$contacts = this.$container.find(".wa-contacts");
        this.$chat_area = this.$container.find(".wa-chat-area");

        // Search with debounce
        this.$container.find(".wa-search-input").on("input", (e) => {
            clearTimeout(this.search_timeout);
            this.search_timeout = setTimeout(() => {
                this.fetch_leads(e.target.value);
            }, 300);
        });

        // Filter bar
        this.$container.find(".wa-filter-bar").on("click", ".wa-filter-btn", (e) => {
            const $btn = $(e.currentTarget);
            this.$container.find(".wa-filter-btn").removeClass("active");
            $btn.addClass("active");
            this.csw_filter = $btn.data("filter");
            this.render_leads();
        });

        // Tag filter clear
        this.$container.find(".wa-tag-filter-clear").on("click", () => {
            this.tag_filter = null;
            this.$container.find(".wa-tag-filter-bar").hide();
            this.render_leads();
        });
    }

    /* ───────────────────── Lead / Contact List ────────────────── */

    fetch_leads(search) {
        frappe.call({
            method: "whatsapp_chat.api.get_leads",
            args: { search: search || "" },
            callback: (r) => {
                this.leads = r.message || [];
                this.render_leads();
            },
        });
    }

    is_csw_open(lead) {
        if (!lead.last_customer_message_time) return false;
        const last = moment(lead.last_customer_message_time);
        const now = moment();
        return now.diff(last, "hours", true) < 24;
    }

    render_leads() {
        // Apply filter
        let filtered = this.leads;
        if (this.csw_filter === "favorites") {
            filtered = this.leads.filter((l) => l.is_favorite);
        } else if (this.csw_filter === "unread") {
            filtered = this.leads.filter((l) => l.unread_count > 0);
        } else if (this.csw_filter === "open") {
            filtered = this.leads.filter((l) => this.is_csw_open(l));
        } else if (this.csw_filter === "closed") {
            filtered = this.leads.filter((l) => !this.is_csw_open(l));
        }

        // Apply tag filter
        if (this.tag_filter) {
            filtered = filtered.filter((l) =>
                (l.tags || []).includes(this.tag_filter)
            );
        }

        if (!filtered.length) {
            const label = this.csw_filter === "all" ? "No leads found"
                : this.csw_filter === "favorites" ? "No favorite leads"
                    : this.csw_filter === "unread" ? "No unread conversations"
                        : this.csw_filter === "open" ? "No leads with an open window"
                            : "No leads with a closed window";
            this.$contacts.html(
                '<div style="text-align:center;color:#8696a0;padding:40px 20px;">' +
                label + "</div>"
            );
            return;
        }

        let html = "";
        for (const lead of filtered) {
            const initials = this.get_initials(lead.lead_name || lead.name);
            const avatar_content = lead.image
                ? `<img src="${lead.image}" alt="">`
                : initials;
            const time = lead.last_message_time
                ? this.relative_time(lead.last_message_time)
                : "";
            const preview = lead.last_message
                ? this.truncate(this.escape(lead.last_message), 45)
                : '<span style="font-style:italic">No messages yet</span>';
            const active = this.current_lead === lead.name ? "active" : "";
            const unread_badge =
                lead.unread_count > 0
                    ? `<span class="wa-unread-badge">${lead.unread_count}</span>`
                    : "";
            const time_class =
                lead.unread_count > 0 ? "time has-unread" : "time";

            // CSW dot indicator
            const csw_open = this.is_csw_open(lead);
            const csw_dot = csw_open
                ? '<span class="wa-csw-dot open" title="Window open">🪟</span>'
                : '<span class="wa-csw-dot closed" title="Window closed">🚪</span>';

            // Favorite star
            const fav_class = lead.is_favorite ? "wa-fav-star active" : "wa-fav-star";
            const fav_title = lead.is_favorite ? "Remove from favorites" : "Add to favorites";

            // Tag chips (show up to 2, then +N)
            const tags = lead.tags || [];
            let tags_html = "";
            if (tags.length) {
                const show = tags.slice(0, 2);
                tags_html = '<div class="wa-contact-tags">' +
                    show.map(t => `<span class="wa-tag-chip" data-tag="${this.escape(t)}">${this.escape(t)}</span>`).join("") +
                    (tags.length > 2 ? `<span class="wa-tag-chip wa-tag-more">+${tags.length - 2}</span>` : "") +
                    '</div>';
            }

            html += `
                <div class="wa-contact ${active}" data-lead="${lead.name}">
                    <div class="wa-contact-avatar">${avatar_content}</div>
                    <div class="wa-contact-info">
                        <div class="wa-contact-name">
                            <span class="wa-contact-name-text">${this.escape(lead.lead_name || lead.name)}</span>
                            <span class="wa-time-csw">
                                <span class="${fav_class}" data-lead="${lead.name}" title="${fav_title}">★</span>
                                <span class="${time_class}">${time}</span>
                                ${csw_dot}
                            </span>
                        </div>
                        <div class="wa-contact-preview">
                            <span class="preview-text">${preview}</span>
                            ${unread_badge}
                        </div>
                        ${tags_html}
                    </div>
                </div>`;
        }

        this.$contacts.html(html);

        // Click handler
        this.$contacts.find(".wa-contact").on("click", (e) => {
            // Don't select lead if clicking star or tag chip
            if ($(e.target).closest(".wa-fav-star, .wa-tag-chip").length) return;
            const lead_name = $(e.currentTarget).data("lead");
            this.select_lead(lead_name);
        });

        // Favorite star click
        this.$contacts.find(".wa-fav-star").on("click", (e) => {
            e.stopPropagation();
            const lead_name = $(e.currentTarget).data("lead");
            this.toggle_favorite(lead_name);
        });

        // Tag chip click → filter by tag
        this.$contacts.find(".wa-tag-chip:not(.wa-tag-more)").on("click", (e) => {
            e.stopPropagation();
            const tag = $(e.currentTarget).data("tag");
            this.tag_filter = tag;
            this.$container.find(".wa-tag-filter-bar").show();
            this.$container.find(".wa-tag-filter-value").text(tag);
            this.render_leads();
        });
    }

    /* ─────────────────────── Select Lead ──────────────────────── */

    select_lead(lead_name) {
        this.current_lead = lead_name;
        const lead = this.leads.find((l) => l.name === lead_name) || {};

        // Highlight active contact
        this.$contacts.find(".wa-contact").removeClass("active");
        this.$contacts
            .find(`[data-lead="${lead_name}"]`)
            .addClass("active");

        // Mobile: show chat
        this.$container.addClass("chat-open");

        const initials = this.get_initials(lead.lead_name || lead_name);
        const avatar_content = lead.image
            ? `<img src="${lead.image}" alt="">`
            : initials;
        const ai_status = lead.custom_ai_chat_onoff || "Off";
        const ai_active = (ai_status === "On" || ai_status === "Pending") ? "active" : "";

        const is_admin = frappe.user_roles.includes("System Manager") || frappe.session.user === "Administrator";
        const assign_html = is_admin ? `
                    <div class="wa-assign-container">
                        <button class="wa-assign-btn" title="Assign Lead">👤 Assign</button>
                        <div class="wa-assign-dropdown" style="display:none;">
                            <div class="wa-assign-header">
                                <span class="wa-assign-title">Assigned To</span>
                                <span class="wa-assign-close">✕</span>
                            </div>
                            <div class="wa-assignee-list"></div>
                            <div class="wa-assign-search-wrap">
                                <input class="wa-assign-search" placeholder="Search users..." />
                            </div>
                            <div class="wa-user-list"></div>
                        </div>
                    </div>` : "";

        // Favorite state for header
        const is_fav = lead.is_favorite;
        const fav_header_class = is_fav ? "wa-header-fav active" : "wa-header-fav";

        // Tags for header display
        const lead_tags = lead.tags || [];
        const tags_header_html = lead_tags.map(t =>
            `<span class="wa-header-tag">${this.escape(t)}<span class="wa-header-tag-remove" data-tag="${this.escape(t)}">✕</span></span>`
        ).join("");

        this.$chat_area.html(`
            <div class="wa-chat-header">
                <button class="wa-back-btn" title="Back">←</button>
                <div class="wa-avatar small">${avatar_content}</div>
                <div class="wa-chat-header-info">
                    <div class="wa-chat-header-name-row">
                        <div class="wa-chat-header-name">${this.escape(lead.lead_name || lead_name)}</div>
                        <button class="${fav_header_class}" data-lead="${lead_name}" title="Toggle favorite">★</button>
                    </div>
                    <div class="wa-chat-header-status">${this.escape(lead.mobile_no || "")}</div>
                </div>
                <div class="wa-chat-header-actions">
                    <div class="wa-tag-container">
                        <button class="wa-tag-btn" title="Manage Tags">🏷️ Tags</button>
                        <div class="wa-tag-dropdown" style="display:none;">
                            <div class="wa-tag-dropdown-header">
                                <span class="wa-tag-dropdown-title">Tags</span>
                                <span class="wa-tag-dropdown-close">✕</span>
                            </div>
                            <div class="wa-tag-current"></div>
                            <div class="wa-tag-search-wrap">
                                <input class="wa-tag-search" placeholder="Add or search tags..." />
                            </div>
                            <div class="wa-tag-suggestions"></div>
                        </div>
                    </div>
                    ${assign_html}
                    <span class="wa-session-badge" title="Customer service window status">
                        🚪 Checking...
                    </span>
                    <span class="wa-ai-timer-badge" title="AI next response countdown">
                        🤖⏳ --
                    </span>
                    <button class="wa-ai-toggle ${ai_active}" data-lead="${lead_name}" title="Click to toggle AI chat">
                        🤖 ${ai_status}
                    </button>
                    <button class="wa-open-lead-btn" title="Open Lead in ERPNext">↗</button>
                </div>
            </div>
            <div class="wa-header-tags-bar">
                ${tags_header_html}
            </div>
            <div class="wa-messages">
                <div class="wa-loading">Loading messages</div>
            </div>
            <div class="wa-input-area">
                <button class="wa-template-btn" title="Send Template">📋</button>
                <textarea class="wa-message-input"
                          placeholder="Type a message"
                          rows="1"></textarea>
                <button class="wa-send-btn" title="Send message">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"/>
                    </svg>
                </button>
            </div>
        `);

        this.$messages = this.$chat_area.find(".wa-messages");

        // Bind events
        this.$chat_area.find(".wa-send-btn").on("click", () => this.send_message());
        this.$chat_area.find(".wa-message-input").on("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.send_message();
            }
        });
        this.$chat_area.find(".wa-template-btn").on("click", () =>
            this.show_template_dialog()
        );
        this.$chat_area.find(".wa-open-lead-btn").on("click", () => {
            window.open(`/app/lead/${lead_name}`, "_blank");
        });
        this.$chat_area.find(".wa-back-btn").on("click", () => {
            this.$container.removeClass("chat-open");
        });
        this.$chat_area.find(".wa-ai-toggle").on("click", () => {
            this.toggle_ai_chat(lead_name);
        });

        // Header favorite toggle
        this.$chat_area.find(".wa-header-fav").on("click", () => {
            this.toggle_favorite(lead_name);
        });

        // Tag management
        this.$chat_area.find(".wa-tag-btn").on("click", (e) => {
            e.stopPropagation();
            const $dd = this.$chat_area.find(".wa-tag-dropdown");
            if ($dd.is(":visible")) {
                $dd.hide();
            } else {
                this.open_tag_dropdown(lead_name);
            }
        });
        this.$chat_area.find(".wa-tag-dropdown-close").on("click", () => {
            this.$chat_area.find(".wa-tag-dropdown").hide();
        });
        this.$chat_area.find(".wa-tag-search").on("input", (e) => {
            this.filter_tag_suggestions(e.target.value);
        });
        // Enter key in tag search → create new tag
        this.$chat_area.find(".wa-tag-search").on("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                const val = $(e.target).val().trim();
                if (val) {
                    this.do_add_tag(lead_name, val);
                    $(e.target).val("");
                }
            }
        });
        // Remove tag from header bar
        this.$chat_area.find(".wa-header-tags-bar").on("click", ".wa-header-tag-remove", (e) => {
            e.stopPropagation();
            const tag = $(e.currentTarget).data("tag");
            this.do_remove_tag(lead_name, tag);
        });
        // Close tag dropdown on outside click
        $(document).on("click.wa-tag", (e) => {
            if (!$(e.target).closest(".wa-tag-container").length) {
                this.$chat_area.find(".wa-tag-dropdown").hide();
            }
        });

        // Assign lead button (admin only)
        if (is_admin) {
            this.$chat_area.find(".wa-assign-btn").on("click", (e) => {
                e.stopPropagation();
                const $dd = this.$chat_area.find(".wa-assign-dropdown");
                if ($dd.is(":visible")) {
                    $dd.hide();
                } else {
                    this.open_assign_dropdown(lead_name);
                }
            });
            this.$chat_area.find(".wa-assign-close").on("click", () => {
                this.$chat_area.find(".wa-assign-dropdown").hide();
            });
            this.$chat_area.find(".wa-assign-search").on("input", (e) => {
                this.filter_assign_users(e.target.value);
            });
            // Close dropdown when clicking outside
            $(document).on("click.wa-assign", (e) => {
                if (!$(e.target).closest(".wa-assign-container").length) {
                    this.$chat_area.find(".wa-assign-dropdown").hide();
                }
            });
        }

        // Auto-resize textarea
        this.$chat_area.find(".wa-message-input").on("input", function () {
            this.style.height = "auto";
            this.style.height = Math.min(this.scrollHeight, 100) + "px";
        });

        // Fetch messages, mark read, and refresh AI status from server
        this.fetch_messages();
        this.mark_read();
        this.refresh_ai_status(lead_name);
        if (is_admin) this.load_assignee_badge(lead_name);
    }

    load_assignee_badge(lead_name) {
        frappe.call({
            method: "whatsapp_chat.api.get_assignees",
            args: { lead: lead_name },
            callback: (r) => {
                this.update_assign_badge(r.message || []);
            },
        });
    }

    refresh_ai_status(lead_name) {
        frappe.call({
            method: "whatsapp_chat.api.get_ai_status",
            args: { lead: lead_name },
            callback: (r) => {
                const data = r.message || {};
                const status = data.status || "Off";
                const is_active = status === "On" || status === "Pending";
                const $btn = this.$chat_area.find(".wa-ai-toggle");
                $btn.attr("class", `wa-ai-toggle ${is_active ? "active" : ""}`)
                    .html(`🤖 ${status}`);

                // Keep leads array in sync
                const lead = this.leads.find((l) => l.name === lead_name);
                if (lead) lead.custom_ai_chat_onoff = status;

                // Update AI timer countdown
                this.update_ai_timer(data);
            },
        });
    }

    update_ai_timer(data) {
        const $timer = this.$chat_area.find(".wa-ai-timer-badge");
        const status = (data.status || "Off").trim();
        const is_active = status === "On" || status === "Pending";

        if (!is_active) {
            $timer.attr("class", "wa-ai-timer-badge off")
                .attr("title", "AI is off")
                .html("🤖⏳ AI off");
            return;
        }

        const ctx = data.wait_context; // 'csw' or 'ocsw'
        const ctx_label = ctx === "csw" ? "🪟" : "🚪";
        const next_response_at = data.next_response_at;

        if (!next_response_at) {
            $timer.attr("class", "wa-ai-timer-badge waiting")
                .attr("title", `AI is active (${ctx === "csw" ? "inside CSW" : "outside CSW"}), no scheduled response`)
                .html(`${ctx_label}🤖⏳ Waiting`);
            return;
        }

        const target = moment(next_response_at);
        const now = moment();
        const diff_min = target.diff(now, "minutes", true);

        if (diff_min <= 0) {
            $timer.attr("class", "wa-ai-timer-badge imminent")
                .attr("title", "AI response is imminent")
                .html(`${ctx_label}🤖⏳ Any moment`);
        } else if (diff_min < 60) {
            $timer.attr("class", "wa-ai-timer-badge active")
                .attr("title", `AI responds at ${target.format("h:mm A")} (${ctx === "csw" ? "inside CSW" : "outside CSW"})`)
                .html(`${ctx_label}🤖⏳ ${Math.ceil(diff_min)}m`);
        } else if (diff_min < 1440) {
            const hrs = Math.floor(diff_min / 60);
            const mins = Math.ceil(diff_min % 60);
            $timer.attr("class", "wa-ai-timer-badge active")
                .attr("title", `AI responds at ${target.format("h:mm A")} (${ctx === "csw" ? "inside CSW" : "outside CSW"})`)
                .html(`${ctx_label}🤖⏳ ${hrs}h ${mins}m`);
        } else {
            const days = Math.floor(diff_min / 1440);
            const hrs = Math.floor((diff_min % 1440) / 60);
            $timer.attr("class", "wa-ai-timer-badge active")
                .attr("title", `AI responds on ${target.format("MMM D, h:mm A")} (outside CSW)`)
                .html(`${ctx_label}🤖⏳ ${days}d ${hrs}h`);
        }
    }

    /* ─────────────────────── Messages ─────────────────────────── */

    fetch_messages() {
        if (!this.current_lead) return;

        frappe.call({
            method: "whatsapp_chat.api.get_messages",
            args: { lead: this.current_lead },
            callback: (r) => {
                const data = r.message || {};
                const messages = data.messages || [];
                this.last_customer_message_time = data.last_customer_message_time || null;
                this.render_messages(messages);
                this.update_session_window();
            },
        });
    }

    render_messages(messages) {
        if (!messages.length) {
            this.$messages.html(
                '<div class="wa-no-messages">' +
                "No messages yet.<br>Send a message to start the conversation." +
                "</div>"
            );
            return;
        }

        let html = "";
        let last_date = "";

        for (const msg of messages) {
            // Date separator
            const date_label = this.format_date(msg.message_origin_time);
            if (date_label !== last_date) {
                html += `<div class="wa-date-separator"><span>${date_label}</span></div>`;
                last_date = date_label;
            }

            const is_customer = msg.message_from === "Customer";
            const bubble_class = is_customer
                ? "wa-message-incoming"
                : "wa-message-outgoing";
            const time = this.format_time(msg.message_origin_time);
            const status_icon = is_customer ? "" : this.status_icon(msg);

            // Sender label
            let sender = "";
            if (is_customer) {
                sender = ""; // No label needed for incoming
            } else if (msg.message_from === "Agent(ai)") {
                sender = '<div class="wa-message-sender">🤖 AI</div>';
            } else {
                sender = '<div class="wa-message-sender">👤 You</div>';
            }

            html += `
                <div class="wa-message ${bubble_class}">
                    ${sender}
                    <div class="wa-message-text">${this.escape(msg.message || "")}<span class="wa-message-meta">
                            <span class="wa-message-time">${time}</span>
                            ${status_icon}
                        </span></div>
                </div>`;
        }

        this.$messages.html(html);
        this.scroll_to_bottom();
    }

    update_session_window() {
        const $badge = this.$chat_area.find(".wa-session-badge");
        const $input = this.$chat_area.find(".wa-message-input");
        const $sendBtn = this.$chat_area.find(".wa-send-btn");

        if (!this.last_customer_message_time) {
            // No customer message ever — outside window
            this.session_window_open = false;
            $badge.attr("class", "wa-session-badge closed")
                .attr("title", "No customer messages yet. Send a template to start.")
                .html("� No session");
            $input.prop("disabled", true)
                .attr("placeholder", "Send a template to start the conversation");
            $sendBtn.prop("disabled", true).addClass("disabled");
            return;
        }

        const last = moment(this.last_customer_message_time);
        const now = moment();
        const hours_left = 24 - now.diff(last, "hours", true);

        if (hours_left > 0) {
            this.session_window_open = true;
            const display = hours_left >= 1
                ? Math.floor(hours_left) + "h " + Math.floor((hours_left % 1) * 60) + "m left"
                : Math.floor(hours_left * 60) + "m left";
            $badge.attr("class", "wa-session-badge open")
                .attr("title", "Customer service window is open")
                .html(`🪟 ${display}`);
            $input.prop("disabled", false)
                .attr("placeholder", "Type a message");
            $sendBtn.prop("disabled", false).removeClass("disabled");
        } else {
            this.session_window_open = false;
            $badge.attr("class", "wa-session-badge closed")
                .attr("title", "Customer service window expired. Use template messages only.")
                .html("� Window closed");
            $input.prop("disabled", true)
                .attr("placeholder", "Window expired — use template messages only");
            $sendBtn.prop("disabled", true).addClass("disabled");
        }
    }

    toggle_ai_chat(lead_name) {
        const $btn = this.$chat_area.find(".wa-ai-toggle");
        $btn.prop("disabled", true).css("opacity", 0.5);

        frappe.call({
            method: "whatsapp_chat.api.toggle_ai_chat",
            args: { lead: lead_name },
            callback: (r) => {
                const new_status = r.message;
                const is_active = new_status === "On" || new_status === "Pending";
                $btn.attr("class", `wa-ai-toggle ${is_active ? "active" : ""}`)
                    .attr("title", `Click to toggle AI chat`)
                    .html(`🤖 ${new_status}`)
                    .prop("disabled", false)
                    .css("opacity", 1);

                // Update in leads array so sidebar stays in sync
                const lead = this.leads.find((l) => l.name === lead_name);
                if (lead) lead.custom_ai_chat_onoff = new_status;

                frappe.show_alert({
                    message: `AI Chat → ${new_status}`,
                    indicator: is_active ? "green" : "orange",
                });
            },
            error: () => {
                $btn.prop("disabled", false).css("opacity", 1);
            },
        });
    }

    status_icon(msg) {
        // Twilio statuses: queued, sending, sent, delivered, read, failed, undelivered
        const s = (msg.status || "").toLowerCase();

        if (s === "read" || msg.client_read_at)
            return '<span class="wa-status-read">✓✓</span>';
        if (s === "delivered" || msg.delivered_at)
            return '<span class="wa-message-status">✓✓</span>';
        if (s === "sent")
            return '<span class="wa-message-status">✓</span>';
        if (s === "failed" || s === "undelivered" || msg.failed_code)
            return '<span class="wa-status-failed">✗</span>';
        if (s === "queued" || s === "sending")
            return '<span class="wa-message-status">🕐</span>';
        return '<span class="wa-message-status">🕐</span>';
    }

    scroll_to_bottom() {
        if (this.$messages && this.$messages.length) {
            const el = this.$messages[0];
            el.scrollTop = el.scrollHeight;
        }
    }

    /* ─────────────────────── Send Message ─────────────────────── */

    send_message() {
        if (!this.session_window_open) {
            frappe.show_alert(
                { message: "Customer service window expired. Use a template message.", indicator: "orange" },
                5
            );
            return;
        }
        const $input = this.$chat_area.find(".wa-message-input");
        const message = $input.val().trim();
        if (!message || !this.current_lead) return;

        $input.val("");
        $input.css("height", "auto");

        // Optimistic UI update
        const now_str = this.format_time(new Date().toISOString());
        this.$messages.find(".wa-no-messages").remove();
        this.$messages.append(`
            <div class="wa-message wa-message-outgoing wa-sending">
                <div class="wa-message-sender">👤 You</div>
                <div class="wa-message-text">${this.escape(message)}<span class="wa-message-meta">
                        <span class="wa-message-time">${now_str}</span>
                        <span class="wa-message-status">🕐</span>
                    </span></div>
            </div>`);
        this.scroll_to_bottom();

        frappe.call({
            method: "whatsapp_chat.api.send_message",
            args: { lead: this.current_lead, message },
            callback: () => {
                this.fetch_messages();
                this.fetch_leads(
                    this.$container.find(".wa-search-input").val()
                );
            },
            error: () => {
                frappe.show_alert(
                    { message: "Failed to send message", indicator: "red" },
                    5
                );
                this.$messages
                    .find(".wa-sending")
                    .last()
                    .find(".wa-message-status")
                    .html('<span class="wa-status-failed">✗</span>');
                this.$messages
                    .find(".wa-sending")
                    .last()
                    .removeClass("wa-sending");
            },
        });
    }

    /* ─────────────────── Template Dialog ──────────────────────── */

    show_template_dialog() {
        if (!this.current_lead) return;

        const lead = this.leads.find((l) => l.name === this.current_lead) || {};

        frappe.call({
            method: "whatsapp_chat.api.get_templates",
            callback: (r) => {
                const templates = r.message || [];
                if (!templates.length) {
                    frappe.msgprint(
                        "No WhatsApp templates found.<br>" +
                        'Create templates at <b>WhatsApp Template</b> DocType.',
                        "No Templates"
                    );
                    return;
                }

                const d = new frappe.ui.Dialog({
                    title: "Send Template Message",
                    fields: [
                        {
                            fieldname: "template",
                            fieldtype: "Select",
                            label: "Template",
                            options: [""].concat(
                                templates.map((t) => t.template_name)
                            ),
                            reqd: 1,
                        },
                        {
                            fieldname: "preview_section",
                            fieldtype: "Section Break",
                            label: "Preview",
                        },
                        {
                            fieldname: "preview",
                            fieldtype: "Small Text",
                            label: "Template Body",
                            read_only: 1,
                        },
                        {
                            fieldname: "variables_section",
                            fieldtype: "Section Break",
                            label: "Variables",
                            depends_on: "eval:doc.template",
                        },
                        {
                            fieldname: "var_1",
                            fieldtype: "Data",
                            label: "{{1}} — Name",
                            default: lead.lead_name || "",
                        },
                        {
                            fieldname: "var_2",
                            fieldtype: "Data",
                            label: "{{2}} — Media URL",
                            default: "introduction.png",
                        },
                    ],
                    primary_action_label: "Send Template",
                    primary_action: (values) => {
                        const selected = templates.find(
                            (t) => t.template_name === values.template
                        );
                        if (!selected) return;

                        // Build variables from fields
                        const vars = {};
                        if (values.var_1) vars["1"] = values.var_1;
                        if (values.var_2) vars["2"] = values.var_2;

                        d.hide();

                        frappe.call({
                            method: "whatsapp_chat.api.send_template",
                            args: {
                                lead: this.current_lead,
                                template_name: selected.template_name,
                                variables: JSON.stringify(vars),
                            },
                            callback: () => {
                                this.fetch_messages();
                                this.fetch_leads(
                                    this.$container
                                        .find(".wa-search-input")
                                        .val()
                                );
                                frappe.show_alert({
                                    message: "Template sent!",
                                    indicator: "green",
                                });
                            },
                        });
                    },
                });

                // Update preview when template is selected
                d.fields_dict.template.$input.on("change", () => {
                    const val = d.get_value("template");
                    const t = templates.find(
                        (t) => t.template_name === val
                    );
                    if (t) {
                        let body = t.body || "(No body preview)";
                        // Show what the populated template will look like
                        const v1 = d.get_value("var_1");
                        const v2 = d.get_value("var_2");
                        let populated = body;
                        if (v1) populated = populated.replace("{{1}}", v1);
                        if (v2) populated = populated.replace("{{2}}", v2);
                        d.set_value("preview", populated);
                    } else {
                        d.set_value("preview", "");
                    }
                });

                // Also refresh preview when variables change
                for (const f of ["var_1", "var_2"]) {
                    d.fields_dict[f].$input.on("input", () => {
                        const val = d.get_value("template");
                        const t = templates.find((t) => t.template_name === val);
                        if (t) {
                            let body = t.body || "";
                            const v1 = d.get_value("var_1");
                            const v2 = d.get_value("var_2");
                            if (v1) body = body.replace("{{1}}", v1);
                            if (v2) body = body.replace("{{2}}", v2);
                            d.set_value("preview", body);
                        }
                    });
                }

                d.show();
            },
        });
    }

    /* ─────────────────────── Mark Read ─────────────────────────── */

    mark_read() {
        if (!this.current_lead) return;
        frappe.call({
            method: "whatsapp_chat.api.mark_read",
            args: { lead: this.current_lead },
            callback: () => {
                // Update badge in contact list
                const lead = this.leads.find(
                    (l) => l.name === this.current_lead
                );
                if (lead) {
                    lead.unread_count = 0;
                    this.render_leads();
                }
            },
        });
    }

    /* ──────────────────── Real-time Updates ────────────────────── */

    setup_realtime() {
        frappe.realtime.on("whatsapp_message", (data) => {
            // Always refresh the contact list
            this.fetch_leads(
                this.$container.find(".wa-search-input").val()
            );

            // If this lead's chat is open, refresh messages + AI status
            if (data.lead === this.current_lead) {
                this.fetch_messages();
                this.mark_read();
                this.refresh_ai_status(data.lead);
            }
        });
    }

    /* ────────────────────── Keyboard ──────────────────────────── */

    setup_keyboard() {
        $(document).on("keydown.whatsapp_chat", (e) => {
            // ESC → deselect lead (or close chat on mobile)
            if (e.key === "Escape") {
                if (this.current_lead) {
                    this.current_lead = null;
                    this.$container.removeClass("chat-open");
                    this.$contacts
                        .find(".wa-contact")
                        .removeClass("active");
                    this.$chat_area.html(`
                        <div class="wa-empty">
                            <div>
                                <div style="font-size:48px;margin-bottom:24px;opacity:0.5">💬</div>
                                <h2>WhatsApp Chat</h2>
                                <p>Select a lead to start chatting.</p>
                            </div>
                        </div>`);
                }
            }
        });
    }

    /* ────────────────────── Utilities ─────────────────────────── */

    // ── Favorite methods ────────────────────────────────────────
    toggle_favorite(lead_name) {
        frappe.call({
            method: "whatsapp_chat.api.toggle_lead_favorite",
            args: { lead: lead_name },
            callback: (r) => {
                const data = r.message || {};
                const lead = this.leads.find((l) => l.name === lead_name);
                if (lead) lead.is_favorite = data.is_favorite;
                this.render_leads();

                // Update header star if this lead is currently open
                if (this.current_lead === lead_name) {
                    const $star = this.$chat_area.find(".wa-header-fav");
                    $star.toggleClass("active", data.is_favorite);
                }

                frappe.show_alert({
                    message: data.is_favorite ? "Added to favorites" : "Removed from favorites",
                    indicator: data.is_favorite ? "green" : "orange",
                });
            },
        });
    }

    // ── Tag methods ─────────────────────────────────────────────
    open_tag_dropdown(lead_name) {
        const $dd = this.$chat_area.find(".wa-tag-dropdown");
        $dd.show();
        this.$chat_area.find(".wa-tag-search").val("").focus();

        // Load current tags and all available tags
        Promise.all([
            new Promise((resolve) => {
                frappe.call({
                    method: "whatsapp_chat.api.get_lead_tags",
                    args: { lead: lead_name },
                    callback: (r) => resolve(r.message || []),
                });
            }),
            new Promise((resolve) => {
                frappe.call({
                    method: "whatsapp_chat.api.get_all_lead_tags",
                    callback: (r) => {
                        this._all_tags_cache = r.message || {};
                        resolve(this._all_tags_cache);
                    },
                });
            }),
        ]).then(([current_tags, all_tags_data]) => {
            this._current_tags = current_tags;
            this._all_tags_data = all_tags_data;
            this.render_current_tags(lead_name, current_tags);
            this.render_tag_suggestions(current_tags, all_tags_data);
        });
    }

    render_current_tags(lead_name, tags) {
        const $list = this.$chat_area.find(".wa-tag-current");
        if (!tags.length) {
            $list.html('<div class="wa-tag-empty">No tags added yet<br><small style="color:#6b7a88;font-size:11px;">Click a tag below to add it</small></div>');
        } else {
            $list.html(
                tags.map(t => `
                    <div class="wa-tag-item">
                        <span class="wa-tag-item-label">${this.escape(t)}</span>
                        <button class="wa-tag-item-remove" data-tag="${this.escape(t)}" title="Remove">&times;</button>
                    </div>
                `).join("")
            );
        }
        // Bind remove
        $list.find(".wa-tag-item-remove").on("click", (e) => {
            e.stopPropagation();
            const tag = $(e.currentTarget).data("tag");
            this.do_remove_tag(lead_name, tag);
        });
    }

    render_tag_suggestions(current_tags, all_tags_data) {
        const all_tags = all_tags_data.tags || [];
        const prebuilt = all_tags_data.prebuilt || [];
        const current_set = new Set(current_tags);
        const available = all_tags.filter(t => !current_set.has(t));
        this._available_tags = available;
        this._render_filtered_tags(available, prebuilt);
    }

    _render_filtered_tags(tags, prebuilt, search_query) {
        const $list = this.$chat_area.find(".wa-tag-suggestions");
        const prebuilt_set = new Set(prebuilt || []);
        const q = (search_query || "").trim();

        let html = "";

        // If there's a search query that doesn't exactly match any existing tag, show "Create" option
        if (q) {
            const all_tags_lower = ((this._all_tags_data || {}).tags || []).map(t => t.toLowerCase());
            const current_lower = (this._current_tags || []).map(t => t.toLowerCase());
            if (!all_tags_lower.includes(q.toLowerCase()) && !current_lower.includes(q.toLowerCase())) {
                html += `<div class="wa-tag-create" data-tag="${this.escape(q)}">＋ Create &amp; add "<strong>${this.escape(q)}</strong>"</div>`;
            }
        }

        if (!tags.length && !html) {
            $list.html('<div class="wa-tag-empty">No tags available. Type above to create a new tag.</div>');
            return;
        }

        // Add section header for available tags
        if (!q && tags.length) {
            html += '<div style="padding:8px 14px 4px;color:#8696a0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Available Tags (Click to Add)</div>';
        }

        html += tags.map(t => {
            const badge = prebuilt_set.has(t) ? '<span class="wa-tag-prebuilt-badge">WA</span>' : '';
            const del_btn = prebuilt_set.has(t) ? '' : `<span class="wa-tag-delete-btn" data-tag="${this.escape(t)}" title="Delete tag permanently">🗑</span>`;
            return `<div class="wa-tag-suggestion" data-tag="${this.escape(t)}">
                <span class="wa-tag-suggestion-left">${badge}<span class="wa-tag-suggestion-label">${this.escape(t)}</span></span>
                ${del_btn}
            </div>`;
        }).join("");

        $list.html(html);

        // Click tag name to add
        $list.find(".wa-tag-suggestion").on("click", (e) => {
            if ($(e.target).closest(".wa-tag-delete-btn").length) return;
            const tag = $(e.currentTarget).data("tag");
            this.do_add_tag(this.current_lead, tag);
        });

        // Click create button
        $list.find(".wa-tag-create").on("click", (e) => {
            const tag = $(e.currentTarget).data("tag");
            this.do_add_tag(this.current_lead, tag);
            this.$chat_area.find(".wa-tag-search").val("");
        });

        // Click delete button → confirm
        $list.find(".wa-tag-delete-btn").on("click", (e) => {
            e.stopPropagation();
            const tag = $(e.currentTarget).data("tag");
            this.confirm_delete_tag(tag);
        });
    }

    filter_tag_suggestions(query) {
        if (!this._available_tags) return;
        const q = (query || "").toLowerCase();
        const filtered = this._available_tags.filter(t => t.toLowerCase().includes(q));
        this._render_filtered_tags(filtered, (this._all_tags_data || {}).prebuilt, query);
    }

    confirm_delete_tag(tag) {
        frappe.confirm(
            `<b>Delete tag "${tag}" permanently?</b><br><br>This will remove the tag from <b>all leads</b> that have it. This action cannot be undone.`,
            () => {
                // On confirm
                frappe.call({
                    method: "whatsapp_chat.api.delete_tag",
                    args: { tag },
                    callback: () => {
                        this._all_tags_cache = null;
                        frappe.show_alert({ message: `Tag "${tag}" deleted`, indicator: "red" });
                        // Refresh tags on all leads
                        this.fetch_leads(this.$container.find(".wa-search-input").val());
                        if (this.current_lead) {
                            this.refresh_lead_tags(this.current_lead);
                        }
                    },
                });
            },
            () => { /* cancelled */ }
        );
    }

    do_add_tag(lead_name, tag) {
        frappe.call({
            method: "whatsapp_chat.api.add_lead_tag",
            args: { lead: lead_name, tag },
            callback: () => {
                // Clear tag cache so next open fetches fresh data
                this._all_tags_cache = null;
                this.refresh_lead_tags(lead_name);
                frappe.show_alert({ message: `Tag "${tag}" added`, indicator: "green" });
            },
        });
    }

    do_remove_tag(lead_name, tag) {
        frappe.call({
            method: "whatsapp_chat.api.remove_lead_tag",
            args: { lead: lead_name, tag },
            callback: () => {
                this._all_tags_cache = null;
                this.refresh_lead_tags(lead_name);
                frappe.show_alert({ message: `Tag "${tag}" removed`, indicator: "orange" });
            },
        });
    }

    refresh_lead_tags(lead_name) {
        frappe.call({
            method: "whatsapp_chat.api.get_lead_tags",
            args: { lead: lead_name },
            callback: (r) => {
                const tags = r.message || [];
                // Update local lead data
                const lead = this.leads.find(l => l.name === lead_name);
                if (lead) lead.tags = tags;
                this.render_leads();

                // Update header tags bar
                const tags_html = tags.map(t =>
                    `<span class="wa-header-tag">${this.escape(t)}<span class="wa-header-tag-remove" data-tag="${this.escape(t)}">✕</span></span>`
                ).join("");
                this.$chat_area.find(".wa-header-tags-bar").html(tags_html);

                // Re-bind remove handlers on header tag bar
                this.$chat_area.find(".wa-header-tags-bar .wa-header-tag-remove").on("click", (e) => {
                    e.stopPropagation();
                    const tag = $(e.currentTarget).data("tag");
                    this.do_remove_tag(lead_name, tag);
                });

                // Refresh dropdown if open
                if (this.$chat_area.find(".wa-tag-dropdown").is(":visible")) {
                    this.open_tag_dropdown(lead_name);
                }
            },
        });
    }

    // ── Assignment methods ──────────────────────────────────────
    open_assign_dropdown(lead_name) {
        const $dd = this.$chat_area.find(".wa-assign-dropdown");
        $dd.show();
        this.$chat_area.find(".wa-assign-search").val("").focus();

        // Load current assignees and all users in parallel
        Promise.all([
            new Promise((resolve) => {
                frappe.call({
                    method: "whatsapp_chat.api.get_assignees",
                    args: { lead: lead_name },
                    callback: (r) => resolve(r.message || []),
                });
            }),
            new Promise((resolve) => {
                if (this._all_users) {
                    resolve(this._all_users);
                } else {
                    frappe.call({
                        method: "whatsapp_chat.api.get_assignable_users",
                        callback: (r) => {
                            this._all_users = r.message || [];
                            resolve(this._all_users);
                        },
                    });
                }
            }),
        ]).then(([assignees, users]) => {
            this._current_assignees = assignees;
            this._assignable_users = users;
            this.render_assignees(assignees);
            this.render_user_list(users, assignees);
        });
    }

    render_assignees(assignees) {
        const $list = this.$chat_area.find(".wa-assignee-list");
        if (!assignees.length) {
            $list.html('<div class="wa-assign-empty">No one assigned</div>');
        } else {
            $list.html(
                assignees
                    .map((a) => {
                        const initials = this.get_initials(a.full_name || a.user);
                        const avatar = a.user_image
                            ? `<img src="${a.user_image}" alt="">`
                            : initials;
                        return `
                        <div class="wa-assignee-item" data-user="${this.escape(a.user)}">
                            <div class="wa-avatar tiny">${avatar}</div>
                            <span class="wa-assignee-name">${this.escape(a.full_name || a.user)}</span>
                            <button class="wa-unassign-btn" title="Remove">✕</button>
                        </div>`;
                    })
                    .join("")
            );
        }
        // Bind unassign
        $list.find(".wa-unassign-btn").on("click", (e) => {
            e.stopPropagation();
            const user = $(e.target).closest(".wa-assignee-item").data("user");
            this.do_unassign(this.current_lead, user);
        });
        this.update_assign_badge(assignees);
    }

    render_user_list(users, assignees) {
        const assigned_set = new Set(assignees.map((a) => a.user));
        const available = users.filter((u) => !assigned_set.has(u.user));
        this._available_users = available;
        this._render_filtered_users(available);
    }

    _render_filtered_users(users) {
        const $list = this.$chat_area.find(".wa-user-list");
        if (!users.length) {
            $list.html('<div class="wa-assign-empty">No users found</div>');
            return;
        }
        $list.html(
            users
                .map((u) => {
                    const initials = this.get_initials(u.full_name || u.user);
                    const avatar = u.user_image
                        ? `<img src="${u.user_image}" alt="">`
                        : initials;
                    return `
                    <div class="wa-user-item" data-user="${this.escape(u.user)}">
                        <div class="wa-avatar tiny">${avatar}</div>
                        <span class="wa-user-name">${this.escape(u.full_name || u.user)}</span>
                        <span class="wa-user-email">${this.escape(u.user)}</span>
                    </div>`;
                })
                .join("")
        );
        $list.find(".wa-user-item").on("click", (e) => {
            const user = $(e.currentTarget).data("user");
            this.do_assign(this.current_lead, user);
        });
    }

    filter_assign_users(query) {
        if (!this._available_users) return;
        const q = (query || "").toLowerCase();
        const filtered = this._available_users.filter(
            (u) =>
                (u.full_name || "").toLowerCase().includes(q) ||
                u.user.toLowerCase().includes(q)
        );
        this._render_filtered_users(filtered);
    }

    do_assign(lead, user) {
        // Optimistic update: add user to local assignee state immediately
        const userObj = (this._all_users || []).find((u) => u.user === user);
        if (userObj && this._current_assignees) {
            const alreadyIn = this._current_assignees.some((a) => a.user === user);
            if (!alreadyIn) {
                this._current_assignees = [...this._current_assignees, userObj];
                this.render_assignees(this._current_assignees);
                this.render_user_list(this._all_users, this._current_assignees);
            }
        }

        frappe.call({
            method: "whatsapp_chat.api.assign_lead",
            args: { lead, user },
            // Silently refresh the dropdown after server confirms
            callback: (r) => {
                // Re-fetch assignees in background to stay in sync
                frappe.call({
                    method: "whatsapp_chat.api.get_assignees",
                    args: { lead },
                    callback: (r2) => {
                        this._current_assignees = r2.message || [];
                        this.render_assignees(this._current_assignees);
                        this.render_user_list(this._all_users, this._current_assignees);
                    },
                });
            },
            error: () => {
                frappe.msgprint("You don't have permission to assign leads.");
                // Revert optimistic update
                this.open_assign_dropdown(lead);
            },
        });
    }

    do_unassign(lead, user) {
        // Optimistic update: remove user from local assignee state immediately
        if (this._current_assignees) {
            this._current_assignees = this._current_assignees.filter((a) => a.user !== user);
            this.render_assignees(this._current_assignees);
            this.render_user_list(this._all_users, this._current_assignees);
        }

        frappe.call({
            method: "whatsapp_chat.api.unassign_lead",
            args: { lead, user },
            callback: () => {
                // Re-fetch assignees in background to stay in sync
                frappe.call({
                    method: "whatsapp_chat.api.get_assignees",
                    args: { lead },
                    callback: (r2) => {
                        this._current_assignees = r2.message || [];
                        this.render_assignees(this._current_assignees);
                        this.render_user_list(this._all_users, this._current_assignees);
                    },
                });
            },
            error: () => {
                frappe.msgprint("You don't have permission to unassign leads.");
                // Revert optimistic update
                this.open_assign_dropdown(lead);
            },
        });
    }

    update_assign_badge(assignees) {
        const $btn = this.$chat_area.find(".wa-assign-btn");
        if (assignees && assignees.length) {
            const names = assignees.map((a) => a.full_name || a.user).join(", ");
            $btn.html(`👤 ${assignees.length}`).attr("title", `Assigned to: ${names}`).addClass("has-assignees");
        } else {
            $btn.html("👤 Assign").attr("title", "Assign Lead").removeClass("has-assignees");
        }
    }

    escape(str) {
        if (!str) return "";
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    truncate(str, len) {
        if (!str) return "";
        return str.length > len ? str.substring(0, len) + "…" : str;
    }

    get_initials(name) {
        if (!name) return "?";
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return parts[0][0].toUpperCase();
    }

    relative_time(datetime_str) {
        if (!datetime_str) return "";
        const then = moment(datetime_str);
        const now = moment();
        const diff_days = now.diff(then, "days");

        if (diff_days === 0) return then.format("h:mm A");
        if (diff_days === 1) return "Yesterday";
        if (diff_days < 7) return then.format("ddd");
        return then.format("DD/MM/YY");
    }

    format_time(datetime_str) {
        if (!datetime_str) return "";
        return moment(datetime_str).format("h:mm A");
    }

    format_date(datetime_str) {
        if (!datetime_str) return "";
        const m = moment(datetime_str);
        const today = moment().startOf("day");
        const yesterday = moment().subtract(1, "day").startOf("day");

        if (m.isSame(today, "day")) return "Today";
        if (m.isSame(yesterday, "day")) return "Yesterday";
        return m.format("MMMM D, YYYY");
    }
}
