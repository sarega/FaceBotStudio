(function () {
  if (window.FaceBotStudioWebChatWidget) {
    return;
  }

  function createId(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 10);
  }

  function getScriptConfig() {
    var current = document.currentScript;
    if (!current) {
      var scripts = document.querySelectorAll("script[data-widget-key]");
      current = scripts[scripts.length - 1];
    }

    if (!current) {
      throw new Error("FaceBotStudio widget script tag not found");
    }

    var widgetKey = current.getAttribute("data-widget-key") || "";
    if (!widgetKey.trim()) {
      throw new Error("FaceBotStudio widget requires data-widget-key");
    }

    var apiBase = current.getAttribute("data-api-base") || "";
    if (!apiBase.trim()) {
      try {
        apiBase = new URL(current.src, window.location.href).origin;
      } catch (_error) {
        apiBase = window.location.origin;
      }
    }

    return {
      widgetKey: widgetKey.trim(),
      apiBase: apiBase.replace(/\/+$/, ""),
      launcherLabel: (current.getAttribute("data-launcher-label") || "").trim(),
    };
  }

  function storageKey(widgetKey, suffix) {
    return "facebotstudio:webchat:" + widgetKey + ":" + suffix;
  }

  function loadJson(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_error) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (_error) {
      // ignore storage errors
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderTicketLinks(tickets) {
    if (!Array.isArray(tickets) || tickets.length === 0) return "";

    return tickets
      .map(function (ticket) {
        var imageUrl = ticket.png_url || ticket.svg_url || "";
        var summary = escapeHtml(ticket.summary_text || ticket.registration_id || "Ticket");
        var id = escapeHtml(ticket.registration_id || "");
        var imageLink = imageUrl
          ? '<a class="fbs-link" href="' + escapeHtml(imageUrl) + '" target="_blank" rel="noopener noreferrer">Open Ticket</a>'
          : "";
        return (
          '<div class="fbs-ticket">' +
          '<div class="fbs-ticket-title">' + id + "</div>" +
          '<div class="fbs-ticket-summary">' + summary + "</div>" +
          imageLink +
          "</div>"
        );
      })
      .join("");
  }

  function renderImageAttachments(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) return "";
    return (
      '<div class="fbs-image-grid">' +
      attachments
        .map(function (attachment) {
          var href = escapeHtml((attachment && (attachment.absolute_url || attachment.url)) || "");
          if (!href) return "";
          var alt = escapeHtml((attachment && attachment.name) || "Attached image");
          return '<a href="' + href + '" target="_blank" rel="noopener noreferrer"><img src="' + href + '" alt="' + alt + '" loading="lazy" /></a>';
        })
        .join("") +
      "</div>"
    );
  }

  function createWidgetUi(config) {
    var root = document.createElement("div");
    root.id = "facebotstudio-webchat-root-" + config.widgetKey;
    document.body.appendChild(root);

    var shadow = root.attachShadow({ mode: "open" });
    var themeColor = config.theme_color || "#2563eb";
    shadow.innerHTML = [
      "<style>",
      ":host{all:initial}",
      ".fbs-wrap{position:fixed;right:20px;bottom:20px;z-index:2147483000;font-family:Inter,system-ui,sans-serif;color:#0f172a}",
      ".fbs-launcher{border:0;background:" + themeColor + ";color:#fff;border-radius:999px;padding:14px 18px;box-shadow:0 16px 32px rgba(15,23,42,.2);font-size:14px;font-weight:700;cursor:pointer}",
      ".fbs-panel{display:none;width:360px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 88px);background:#fff;border:1px solid #dbe3ef;border-radius:22px;overflow:hidden;box-shadow:0 24px 60px rgba(15,23,42,.22)}",
      ".fbs-panel.open{display:flex;flex-direction:column}",
      ".fbs-header{padding:16px 18px;background:" + themeColor + ";color:#fff}",
      ".fbs-title{margin:0;font-size:16px;font-weight:800}",
      ".fbs-subtitle{margin:6px 0 0;font-size:12px;opacity:.9;line-height:1.4}",
      ".fbs-body{flex:1;overflow:auto;background:#f8fafc;padding:14px;display:flex;flex-direction:column;gap:10px}",
      ".fbs-msg{max-width:82%;padding:11px 13px;border-radius:16px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word}",
      ".fbs-msg.user{align-self:flex-end;background:" + themeColor + ";color:#fff;border-bottom-right-radius:6px}",
      ".fbs-msg.bot{align-self:flex-start;background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-bottom-left-radius:6px}",
      ".fbs-ticket-list{display:flex;flex-direction:column;gap:8px;margin-top:8px}",
      ".fbs-ticket{border:1px solid #dbe3ef;background:#fff;border-radius:14px;padding:10px}",
      ".fbs-ticket-title{font-size:11px;font-weight:800;color:#2563eb;text-transform:uppercase;letter-spacing:.08em}",
      ".fbs-ticket-summary{margin-top:6px;font-size:12px;color:#334155;line-height:1.45;white-space:pre-wrap}",
      ".fbs-link{display:inline-flex;margin-top:8px;font-size:12px;font-weight:700;color:" + themeColor + ";text-decoration:none}",
      ".fbs-footer{border-top:1px solid #e2e8f0;padding:12px;background:#fff}",
      ".fbs-composer{display:flex;gap:8px;align-items:flex-end}",
      ".fbs-attach{border:1px solid #cbd5e1;background:#f8fafc;color:#334155;border-radius:14px;width:44px;height:44px;font-size:18px;font-weight:700;cursor:pointer;flex:none}",
      ".fbs-input{flex:1;border:1px solid #cbd5e1;border-radius:14px;padding:11px 12px;font-size:13px;outline:none}",
      ".fbs-send{border:0;background:" + themeColor + ";color:#fff;border-radius:14px;padding:0 16px;font-size:13px;font-weight:700;cursor:pointer}",
      ".fbs-send[disabled]{opacity:.55;cursor:not-allowed}",
      ".fbs-preview-strip{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px}",
      ".fbs-preview{position:relative;width:56px;height:56px;overflow:hidden;border-radius:12px;border:1px solid #dbe3ef;background:#f8fafc}",
      ".fbs-preview img{display:block;width:100%;height:100%;object-fit:cover}",
      ".fbs-preview-remove{position:absolute;top:4px;right:4px;border:0;background:rgba(15,23,42,.75);color:#fff;border-radius:999px;width:20px;height:20px;cursor:pointer;font-size:12px;line-height:1}",
      ".fbs-image-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px}",
      ".fbs-image-grid a{display:block;overflow:hidden;border-radius:12px;border:1px solid #dbe3ef;background:#fff}",
      ".fbs-image-grid img{display:block;width:100%;height:110px;object-fit:cover}",
      ".fbs-meta{font-size:11px;color:#64748b;text-align:center;padding:6px 0 0}",
      ".fbs-topbar{display:flex;justify-content:space-between;align-items:center;gap:8px}",
      ".fbs-close{border:0;background:rgba(255,255,255,.18);color:#fff;border-radius:999px;width:30px;height:30px;cursor:pointer;font-size:18px;line-height:1}",
      "</style>",
      '<div class="fbs-wrap">',
      '<button class="fbs-launcher" type="button"></button>',
      '<div class="fbs-panel" role="dialog" aria-live="polite">',
      '<div class="fbs-header"><div class="fbs-topbar"><div><p class="fbs-title"></p><p class="fbs-subtitle"></p></div><button class="fbs-close" type="button" aria-label="Close">&times;</button></div></div>',
      '<div class="fbs-body"></div>',
      '<form class="fbs-footer"><input class="fbs-file" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden /><div class="fbs-preview-strip"></div><div class="fbs-composer"><button class="fbs-attach" type="button" aria-label="Attach image">+</button><input class="fbs-input" type="text" placeholder="พิมพ์ข้อความ..." /><button class="fbs-send" type="submit">Send</button></div></form>',
      "</div>",
      "</div>",
    ].join("");

    return {
      root: root,
      shadow: shadow,
      launcher: shadow.querySelector(".fbs-launcher"),
      panel: shadow.querySelector(".fbs-panel"),
      title: shadow.querySelector(".fbs-title"),
      subtitle: shadow.querySelector(".fbs-subtitle"),
      close: shadow.querySelector(".fbs-close"),
      body: shadow.querySelector(".fbs-body"),
      form: shadow.querySelector(".fbs-footer"),
      fileInput: shadow.querySelector(".fbs-file"),
      previewStrip: shadow.querySelector(".fbs-preview-strip"),
      attach: shadow.querySelector(".fbs-attach"),
      input: shadow.querySelector(".fbs-input"),
      send: shadow.querySelector(".fbs-send"),
    };
  }

  function appendMessage(ui, role, text, extraHtml, attachments) {
    var container = document.createElement("div");
    container.className = "fbs-msg " + role;
    container.innerHTML = escapeHtml(text || "");
    var attachmentHtml = renderImageAttachments(attachments || []);
    if (attachmentHtml) {
      var attachmentBlock = document.createElement("div");
      attachmentBlock.innerHTML = attachmentHtml;
      container.appendChild(attachmentBlock);
    }
    if (extraHtml) {
      var extra = document.createElement("div");
      extra.className = "fbs-ticket-list";
      extra.innerHTML = extraHtml;
      container.appendChild(extra);
    }
    ui.body.appendChild(container);
    ui.body.scrollTop = ui.body.scrollHeight;
  }

  function renderConversation(ui, messages) {
    ui.body.innerHTML = "";
    messages.forEach(function (message) {
      appendMessage(ui, message.role, message.text, message.extraHtml || "", message.attachments || []);
    });
  }

  async function bootstrap() {
    var config = getScriptConfig();
    var senderId = window.localStorage.getItem(storageKey(config.widgetKey, "senderId"));
    if (!senderId) {
      senderId = createId("visitor");
      window.localStorage.setItem(storageKey(config.widgetKey, "senderId"), senderId);
    }

    var response = await fetch(config.apiBase + "/api/webchat/config/" + encodeURIComponent(config.widgetKey), {
      method: "GET",
      credentials: "omit",
    });
    if (!response.ok) {
      throw new Error("Failed to load widget config (" + response.status + ")");
    }

    var payload = await response.json();
    var widget = payload.widget || {};
    var ui = createWidgetUi({
      widgetKey: config.widgetKey,
      theme_color: widget.theme_color || "#2563eb",
      welcome_text: widget.welcome_text || "",
      event_name: widget.event_name || "Event Assistant",
      launcherLabel: config.launcherLabel || "Chat",
    });

    var storedMessages = loadJson(storageKey(config.widgetKey, "messages"), []);
    if (!Array.isArray(storedMessages)) {
      storedMessages = [];
    }

    ui.launcher.textContent = config.launcherLabel || "Chat with us";
    ui.title.textContent = widget.event_name || "Event Assistant";
    ui.subtitle.textContent = widget.welcome_text || "Ask about the event, registration, and tickets.";

    if (storedMessages.length === 0 && widget.welcome_text) {
      storedMessages.push({ role: "bot", text: widget.welcome_text, extraHtml: "" });
      saveJson(storageKey(config.widgetKey, "messages"), storedMessages);
    }

    renderConversation(ui, storedMessages);
    var pendingImages = [];

    function renderPendingImages() {
      if (!ui.previewStrip) return;
      ui.previewStrip.innerHTML = "";
      if (!pendingImages.length) return;
      pendingImages.forEach(function (item) {
        var wrapper = document.createElement("div");
        wrapper.className = "fbs-preview";
        wrapper.innerHTML = '<img src="' + escapeHtml(item.previewUrl) + '" alt="' + escapeHtml(item.file.name || "image") + '" /><button class="fbs-preview-remove" type="button" aria-label="Remove image">&times;</button>';
        wrapper.querySelector(".fbs-preview-remove").addEventListener("click", function () {
          removePendingImage(item.id);
        });
        ui.previewStrip.appendChild(wrapper);
      });
    }

    function clearPendingImages() {
      pendingImages.forEach(function (item) {
        try { URL.revokeObjectURL(item.previewUrl); } catch (_error) {}
      });
      pendingImages = [];
      if (ui.fileInput) ui.fileInput.value = "";
      renderPendingImages();
    }

    function removePendingImage(id) {
      pendingImages = pendingImages.filter(function (item) {
        if (item.id === id) {
          try { URL.revokeObjectURL(item.previewUrl); } catch (_error) {}
          return false;
        }
        return true;
      });
      renderPendingImages();
    }

    function handleFileSelection(event) {
      var files = Array.prototype.slice.call((event && event.target && event.target.files) || []);
      if (!files.length) return;
      var errors = [];
      files.forEach(function (file) {
        if (!/image\/(png|jpeg|webp)/.test(file.type || "")) {
          errors.push((file.name || "image") + ": PNG, JPG, or WebP only");
          return;
        }
        if ((file.size || 0) > 6 * 1024 * 1024) {
          errors.push((file.name || "image") + ": max 6 MB");
          return;
        }
        if (pendingImages.length >= 4) {
          errors.push("Up to 4 images per message");
          return;
        }
        pendingImages.push({
          id: createId("pending-image"),
          file: file,
          previewUrl: URL.createObjectURL(file),
        });
      });
      renderPendingImages();
      if (ui.fileInput) ui.fileInput.value = "";
      if (errors.length) {
        storedMessages.push({ role: "bot", text: errors.join(" · "), extraHtml: "", attachments: [] });
        saveJson(storageKey(config.widgetKey, "messages"), storedMessages);
        renderConversation(ui, storedMessages);
      }
    }

    async function uploadImage(file) {
      var result = await fetch(config.apiBase + "/api/webchat/attachments/image?widget_key=" + encodeURIComponent(config.widgetKey), {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "x-upload-filename": encodeURIComponent(file.name || "image"),
        },
        body: file,
        credentials: "omit",
      });
      var data = await result.json().catch(function () { return {}; });
      if (!result.ok) {
        throw new Error(data && data.error ? data.error : "Failed to upload image");
      }
      return data && data.attachment ? data.attachment : null;
    }

    function toggle(open) {
      var shouldOpen = typeof open === "boolean" ? open : !ui.panel.classList.contains("open");
      ui.panel.classList.toggle("open", shouldOpen);
      ui.launcher.style.display = shouldOpen ? "none" : "inline-flex";
      if (shouldOpen) {
        setTimeout(function () {
          ui.input.focus();
          ui.body.scrollTop = ui.body.scrollHeight;
        }, 30);
      }
    }

    async function sendMessage(text) {
      var cleaned = String(text || "").trim();
      if (!cleaned && pendingImages.length === 0) return;
      ui.send.disabled = true;
      if (ui.attach) ui.attach.disabled = true;

      try {
        var uploadedAttachments = pendingImages.length
          ? (await Promise.all(pendingImages.map(function (item) { return uploadImage(item.file); }))).filter(Boolean)
          : [];
        storedMessages.push({ role: "user", text: cleaned, extraHtml: "", attachments: uploadedAttachments });
        saveJson(storageKey(config.widgetKey, "messages"), storedMessages);
        renderConversation(ui, storedMessages);
        ui.input.value = "";
        clearPendingImages();

        var result = await fetch(config.apiBase + "/api/webchat/messages?widget_key=" + encodeURIComponent(config.widgetKey), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            widget_key: config.widgetKey,
            sender_id: senderId,
            text: cleaned,
            attachments: uploadedAttachments,
          }),
          credentials: "omit",
        });

        var data = await result.json();
        if (!result.ok) {
          throw new Error(data && data.error ? data.error : "Failed to send message");
        }

        var extraHtml = "";
        if (Array.isArray(data.tickets) && data.tickets.length > 0) {
          extraHtml = renderTicketLinks(data.tickets);
          if (data.map_url) {
            extraHtml += '<a class="fbs-link" href="' + escapeHtml(data.map_url) + '" target="_blank" rel="noopener noreferrer">Open Map</a>';
          }
        } else if (data.map_url) {
          extraHtml = '<a class="fbs-link" href="' + escapeHtml(data.map_url) + '" target="_blank" rel="noopener noreferrer">Open Map</a>';
        }

        if ((data.reply_text && String(data.reply_text).trim()) || extraHtml) {
          storedMessages.push({
            role: "bot",
            text: data.reply_text || "",
            extraHtml: extraHtml,
            attachments: [],
          });
          saveJson(storageKey(config.widgetKey, "messages"), storedMessages);
          renderConversation(ui, storedMessages);
        }
      } catch (error) {
        storedMessages.push({
          role: "bot",
          text: error && error.message ? error.message : "Unable to send message right now.",
          extraHtml: "",
          attachments: [],
        });
        saveJson(storageKey(config.widgetKey, "messages"), storedMessages);
        renderConversation(ui, storedMessages);
      } finally {
        ui.send.disabled = false;
        if (ui.attach) ui.attach.disabled = false;
      }
    }

    ui.launcher.addEventListener("click", function () {
      toggle(true);
    });
    ui.close.addEventListener("click", function () {
      toggle(false);
    });
    if (ui.attach && ui.fileInput) {
      ui.attach.addEventListener("click", function () {
        ui.fileInput.click();
      });
      ui.fileInput.addEventListener("change", handleFileSelection);
    }
    ui.form.addEventListener("submit", function (event) {
      event.preventDefault();
      sendMessage(ui.input.value);
    });

    window.FaceBotStudioWebChatWidget = {
      open: function () { toggle(true); },
      close: function () { toggle(false); },
      send: sendMessage,
      clear: function () {
        saveJson(storageKey(config.widgetKey, "messages"), []);
        renderConversation(ui, []);
      },
    };
  }

  bootstrap().catch(function (error) {
    console.error("FaceBotStudio web chat widget failed to initialize:", error);
  });
})();
