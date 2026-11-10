// mindmap-bundle.js — single-file bundle (no ES modules, works on file://)
(function () {
  "use strict";

  const IS_OBSIDIAN = !!window.__PKM_OBSIDIAN__;

  function postHost(type, payload = {}, transfer = []) {
    if (!IS_OBSIDIAN || !window.parent) return;
    window.parent.postMessage({ source: "pkm-mindmap", type, ...payload }, "*", transfer);
  }

  const _hostPromptRequests = new Map();

  function requestTextPrompt({ heading, initialValue = "", placeholder = "", submitLabel = "OK" }) {
    if (!IS_OBSIDIAN) {
      return Promise.resolve(window.prompt(heading, initialValue));
    }
    const requestId = "prompt_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        _hostPromptRequests.delete(requestId);
        resolve(null);
      }, 120000);
      _hostPromptRequests.set(requestId, { resolve, timer });
      postHost("prompt-request", {
        requestId,
        heading,
        initialValue,
        placeholder,
        submitLabel
      });
    });
  }

  const _hostConfirmRequests = new Map();

  function requestConfirmation({ heading, message, confirmLabel = "Confirm" }) {
    if (!IS_OBSIDIAN) return Promise.resolve(window.confirm(message || heading));
    const requestId = "confirm_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        _hostConfirmRequests.delete(requestId);
        resolve(false);
      }, 120000);
      _hostConfirmRequests.set(requestId, { resolve, timer });
      postHost("confirm-request", { requestId, heading, message, confirmLabel });
    });
  }

  const _hostNoteRequests = new Map();
  const _hostAIRequests = new Map();

  function requestHostNote(type, payload = {}, timeoutMs = 120000) {
    if (!IS_OBSIDIAN) return Promise.resolve(null);
    const requestId = "note_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        _hostNoteRequests.delete(requestId);
        reject(new Error("Timed out while communicating with the Obsidian note host"));
      }, timeoutMs);
      _hostNoteRequests.set(requestId, { resolve, reject, timer });
      postHost(type, { requestId, ...payload });
    });
  }

  function noteHtmlToPlainText(value) {
    const template = document.createElement("template");
    template.innerHTML = sanitizeNoteHtml(value || "");
    const blockTags = new Set(["P", "DIV", "LI", "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6"]);
    const lines = [];
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        lines.push(node.nodeValue || "");
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === "BR") lines.push("\n");
      for (const child of node.childNodes) walk(child);
      if (blockTags.has(tag)) lines.push("\n");
    }
    for (const child of template.content.childNodes) walk(child);
    return lines.join("").replace(/\n{3,}/g, "\n\n").trim();
  }


  function noteHtmlToMarkdown(value) {
    const template = document.createElement("template");
    template.innerHTML = sanitizeNoteHtml(value || "");

    function render(node, listDepth = 0) {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const tag = node.tagName;
      const inner = Array.from(node.childNodes).map((child) => render(child, listDepth)).join("");
      if (tag === "BR") return "\n";
      if (tag === "STRONG" || tag === "B") return `**${inner}**`;
      if (tag === "EM" || tag === "I") return `*${inner}*`;
      if (tag === "S" || tag === "DEL") return `~~${inner}~~`;
      if (tag === "CODE") return `\`${inner.replace(/`/g, "\\`")}\``;
      if (tag === "A") {
        const href = sanitizeExternalUrl(node.getAttribute("href"));
        return href ? `[${inner || href}](${href})` : inner;
      }
      if (/^H[1-6]$/.test(tag)) return `${"#".repeat(Number(tag.slice(1)))} ${inner.trim()}\n\n`;
      if (tag === "BLOCKQUOTE") return inner.split(/\r?\n/).filter(Boolean).map((line) => `> ${line}`).join("\n") + "\n\n";
      if (tag === "LI") {
        const parentTag = node.parentElement ? node.parentElement.tagName : "UL";
        const siblings = node.parentElement ? Array.from(node.parentElement.children).filter((child) => child.tagName === "LI") : [];
        const index = Math.max(0, siblings.indexOf(node));
        const marker = parentTag === "OL" ? `${index + 1}. ` : "- ";
        return `${"  ".repeat(listDepth)}${marker}${inner.trim()}\n`;
      }
      if (tag === "UL" || tag === "OL") return Array.from(node.childNodes).map((child) => render(child, listDepth + 1)).join("") + "\n";
      if (tag === "P" || tag === "DIV" || tag === "PRE") return `${inner.trimEnd()}\n\n`;
      return inner;
    }

    const markdown = Array.from(template.content.childNodes).map((child) => render(child, 0)).join("");
    return markdown.replace(/\n{3,}/g, "\n\n").trim();
  }

  // ── tree-utils.js ──────────────────────────────────────────────────────────

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sanitizeExternalUrl(value) {
    const url = String(value || "").trim();
    if (!url) return null;
    if (/^(https?:|mailto:)/i.test(url)) return url;
    return null;
  }

  function sanitizeNoteHtml(value) {
    const template = document.createElement("template");
    template.innerHTML = String(value || "");

    const allowedTags = new Set([
      "P", "BR", "DIV", "SPAN", "STRONG", "B", "EM", "I", "U", "S", "DEL",
      "UL", "OL", "LI", "BLOCKQUOTE", "CODE", "PRE", "A", "H1", "H2", "H3",
      "H4", "H5", "H6"
    ]);
    const allowedAttributes = {
      A: new Set(["href", "title"])
    };

    const elements = Array.from(template.content.querySelectorAll("*"));
    for (const element of elements) {
      if (!allowedTags.has(element.tagName)) {
        const parent = element.parentNode;
        if (parent) {
          while (element.firstChild) parent.insertBefore(element.firstChild, element);
          element.remove();
        }
        continue;
      }

      for (const attribute of Array.from(element.attributes)) {
        const allowedForTag = allowedAttributes[element.tagName];
        if (!allowedForTag || !allowedForTag.has(attribute.name.toLowerCase())) {
          element.removeAttribute(attribute.name);
        }
      }

      if (element.tagName === "A") {
        const safeHref = sanitizeExternalUrl(element.getAttribute("href"));
        if (safeHref) {
          element.setAttribute("href", safeHref);
          element.setAttribute("target", "_blank");
          element.setAttribute("rel", "noopener noreferrer");
        } else {
          element.removeAttribute("href");
          element.removeAttribute("target");
          element.removeAttribute("rel");
        }
      }
    }

    return template.innerHTML;
  }

  function normalizeNodeWithIds(nodeData, nextIdRef) {
    const normalized = { ...nodeData };
    if (!Number.isInteger(normalized.id)) {
      normalized.id = nextIdRef.value;
      nextIdRef.value += 1;
    } else {
      nextIdRef.value = Math.max(nextIdRef.value, normalized.id + 1);
    }
    const children = Array.isArray(normalized.children) ? normalized.children : [];
    normalized.children = children.map((child) => normalizeNodeWithIds(child, nextIdRef));
    return normalized;
  }

  function normalizeJsonWithStableIds(jsonData, startId = 1) {
    const normalized = cloneJson(jsonData || {});
    const nextIdRef = { value: Math.max(1, startId) };
    const rootNodes = Array.isArray(normalized.nodes) ? normalized.nodes : [];
    normalized.nodes = rootNodes.map((node) => normalizeNodeWithIds(node, nextIdRef));
    return { normalized, nextId: nextIdRef.value };
  }

  function collectNodesById(nodeList, targetMap = new Map()) {
    for (const node of nodeList || []) {
      targetMap.set(node.id, node);
      if (Array.isArray(node.children) && node.children.length > 0) {
        collectNodesById(node.children, targetMap);
      }
    }
    return targetMap;
  }

  function mergeHiddenBranchesById(visibleData, originalData) {
    const originalById = collectNodesById(originalData.nodes || []);

    function mergeNode(visibleNode) {
      const mergedChildren = (visibleNode.children || []).map((child) => mergeNode(child));
      const visibleChildIds = new Set(mergedChildren.map((child) => child.id));
      const originalNode = originalById.get(visibleNode.id);
      const hiddenChildren =
        originalNode && Array.isArray(originalNode.children)
          ? originalNode.children.filter((child) => child.hidden && !visibleChildIds.has(child.id))
          : [];
      // Preserve ALL fields from visibleNode — only replace children.
      return {
        ...visibleNode,
        children: [...mergedChildren, ...cloneJson(hiddenChildren)]
      };
    }

    return {
      nodes: (visibleData.nodes || []).map((node) => mergeNode(node)),
      viewScale: visibleData.viewScale,
      viewOffsetX: visibleData.viewOffsetX,
      viewOffsetY: visibleData.viewOffsetY
    };
  }

  // ── state.js ───────────────────────────────────────────────────────────────

  const BRANCH_THEMES = {
    Calm: {
      nodeFills: ["#eef2ff", "#e0f2fe", "#dcfce7", "#fef3c7", "#ffe4e6", "#ede9fe"],
      nodeBorders: ["#4f46e5", "#0284c7", "#16a34a", "#d97706", "#e11d48", "#7c3aed"],
      nodeTexts: ["#312e81", "#0c4a6e", "#14532d", "#7c2d12", "#881337", "#4c1d95"],
      linkColors: ["#6366f1", "#0284c7", "#16a34a", "#d97706", "#e11d48", "#7c3aed"]
    },
    Vivid: {
      nodeFills: ["#dbeafe", "#cffafe", "#d9f99d", "#fed7aa", "#fecdd3", "#ddd6fe"],
      nodeBorders: ["#2563eb", "#0e7490", "#65a30d", "#ea580c", "#e11d48", "#7c3aed"],
      nodeTexts: ["#1e3a8a", "#164e63", "#365314", "#7c2d12", "#9f1239", "#5b21b6"],
      linkColors: ["#2563eb", "#06b6d4", "#65a30d", "#f97316", "#f43f5e", "#8b5cf6"]
    },
    Minimal: {
      nodeFills: ["#f8fafc", "#f1f5f9", "#e2e8f0", "#f1f5f9", "#f8fafc", "#e2e8f0"],
      nodeBorders: ["#334155", "#475569", "#64748b", "#475569", "#334155", "#64748b"],
      nodeTexts: ["#0f172a", "#0f172a", "#0f172a", "#0f172a", "#0f172a", "#0f172a"],
      linkColors: ["#334155", "#475569", "#64748b", "#475569", "#334155", "#64748b"]
    }
  };

  function getBranchTheme(state) {
    return BRANCH_THEMES[state.branchTheme] || BRANCH_THEMES.Calm;
  }

  function createAppState() {
    const canvas = document.getElementById("mindmap");
    const ctx = canvas.getContext("2d");
    return {
      canvas,
      ctx,
      renameInput: document.getElementById("renameInput"),
      reorderUp: document.getElementById("reorderUp"),
      reorderDown: document.getElementById("reorderDown"),
      statusMessage: document.getElementById("statusMessage"),
      loadingIndicator: document.getElementById("loadingIndicator"),
      loadingText: document.getElementById("loadingText"),
      toolbar: document.getElementById("toolbar"),
      toolbarToggle: document.getElementById("toolbarToggle"),
      saveBtn: document.getElementById("saveBtn"),
      addBtn: document.getElementById("addBtn"),
      deleteBtn: document.getElementById("deleteBtn"),
      centerBtn: document.getElementById("centerBtn"),
      undoBtn: document.getElementById("undoBtn"),
      clearBtn: document.getElementById("clearBtn"),
      collapseBtn: document.getElementById("collapseBtn"),
      focusBtn: document.getElementById("focusBtn"),
      layoutBtn: document.getElementById("layoutBtn"),
      pinBtn: document.getElementById("pinBtn"),
      themeBtn: document.getElementById("themeBtn"),

      originalJsonData: null,
      nodes: [],
      links: [],
      selectedNode: null,
      draggingNode: null,
      resizingNode: null,
      resizeStartMouseX: 0,
      resizeStartWidth: 0,
      resizeDidChange: false,
      ghostX: 0,
      ghostY: 0,
      offsetX: 0,
      offsetY: 0,
      isDragging: false,
      showGhostNode: false,
      debugShowZones: false,
      nodeZones: [],

      viewOffsetX: 0,
      viewOffsetY: 0,
      viewScale: 1,
      isPanning: false,
      panStartX: 0,
      panStartY: 0,

      lastTouchDist: null,
      lastTapTime: 0,
      lastTapNode: null,

      potentialParent: null,
      insertPosition: -1,

      history: [],
      maxHistorySteps: 20,

      currentGistId: null,
      hasUnsavedChanges: false,
      centerButtonClicks: [],

      animationFrameRequested: false,
      nextNodeId: 1,

      layoutMode: "horizontal",
      focusNodeId: null,
      visibleNodeIds: new Set(),
      visibleLinkKeys: new Set(),
      lastDragEndAt: 0,
      lastPointerDownNodeId: null,

      branchTheme: "Calm",
      maxVisibleLevel: null,
      layoutTransitionActive: false,
      searchMatchIds: new Set(),

      // ── Multi-map ──────────────────────────────────────────────────────────
      maps: [],         // [{id, name, rootId}]
      activeMapId: null,

      // ── Relationship lines ─────────────────────────────────────────────────
      relLines: [],
      relLinePickMode: false,
      relLineSourceId: null,
      relLineMouseX: null,
      relLineMouseY: null,
      selectedRelLineId: null,
      draggingRelLabel: null,
      draggingRelLine: null,
      _relLineDragMoved: false,
      _relLabelRects: new Map(),
      _relCtrlPtRects: new Map(),
      _relPanelOpts: null,

      savePartBtn: document.getElementById("savePartBtn"),
      pushPartBtn: document.getElementById("pushPartBtn"),
      partsBtn: document.getElementById("partsBtn"),
      pinRefBtn: document.getElementById("pinRefBtn"),
      tagBtn: document.getElementById("tagBtn"),
      attachBtn: document.getElementById("attachBtn"),
      noteBtn: document.getElementById("noteBtn"),
      relLinkBtn: document.getElementById("relLinkBtn"),
      loadBtn: document.getElementById("loadBtn"),
      toolbarMinBtn: document.getElementById("toolbarMinBtn"),
      toolbarRevealBtn: document.getElementById("toolbarRevealBtn"),
      newMapBtn: document.getElementById("newMapBtn"),
      mapsBtn: document.getElementById("mapsBtn"),
      nodeContextPanel: document.getElementById("nodeContextPanel"),
      levelFilterSelect: document.getElementById("levelFilterSelect"),
      noteSyncTimer: null
    };
  }

  function setCanvasSize(state) {
    state.canvas.width = window.innerWidth;
    state.canvas.height = window.innerHeight;
  }

  const MAX_NODE_TEXT_W = 240;
  const MIN_NODE_WIDTH = 80;
  const MAX_NODE_WIDTH = 640;
  const NODE_RESIZE_HANDLE_SIZE = 12;
  const NODE_LINE_H = 20;
  const NODE_V_PAD = 14;

  function getWrappedLines(ctx, text, maxW) {
    ctx.font = "600 14px system-ui";
    const maxContentWidth = Math.max(20, maxW - 20);
    const source = String(text ?? "");
    const lines = [];

    const graphemes = (value) => {
      if (typeof Intl !== "undefined" && Intl.Segmenter) {
        return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), (item) => item.segment);
      }
      return Array.from(value);
    };

    const breakLongSegment = (segment) => {
      const chunks = [];
      let chunk = "";
      for (const glyph of graphemes(segment)) {
        const test = chunk + glyph;
        if (chunk && ctx.measureText(test).width > maxContentWidth) {
          chunks.push(chunk);
          chunk = glyph;
        } else {
          chunk = test;
        }
      }
      if (chunk) chunks.push(chunk);
      return chunks;
    };

    const wrapParagraph = (paragraph) => {
      if (!paragraph) { lines.push(""); return; }
      let segments;
      if (typeof Intl !== "undefined" && Intl.Segmenter) {
        segments = Array.from(new Intl.Segmenter(undefined, { granularity: "word" }).segment(paragraph), (item) => item.segment);
      } else {
        segments = paragraph.match(/\s+|[^\s]+/gu) || [paragraph];
      }

      let line = "";
      for (const segment of segments) {
        const isWhitespace = /^\s+$/u.test(segment);
        if (isWhitespace && !line) continue;
        const test = line + segment;
        if (ctx.measureText(test).width <= maxContentWidth) {
          line = test;
          continue;
        }
        if (line.trim()) lines.push(line.trimEnd());
        line = "";
        if (isWhitespace) continue;
        if (ctx.measureText(segment).width <= maxContentWidth) {
          line = segment;
          continue;
        }
        const chunks = breakLongSegment(segment);
        for (let i = 0; i < chunks.length; i++) {
          if (i < chunks.length - 1) lines.push(chunks[i]);
          else line = chunks[i];
        }
      }
      if (line.trim() || lines.length === 0) lines.push(line.trimEnd());
    };

    const paragraphs = source.split(/\r?\n/u);
    paragraphs.forEach((paragraph, index) => {
      wrapParagraph(paragraph);
      if (index < paragraphs.length - 1 && paragraph === "") lines.push("");
    });
    return lines.length > 0 ? lines : [source];
  }

  function createNode(state, text, explicitId = null) {
    const resolvedId = explicitId ?? state.nextNodeId;
    state.nextNodeId = Math.max(state.nextNodeId, resolvedId + 1);

    const node = {
      id: resolvedId,
      text,
      numbering: "",
      x: 0,
      y: 0,
      renderX: 0,
      renderY: 0,
      height: 40,
      textBoxH: 40,
      width: 100,
      customWidth: null,
      parent: null,
      children: [],
      collapsed: false,
      pinned: false,
      tags: [],
      attachments: [],
      note: null,
      noteFilePath: null,
      instanceState: "live",
      pinnedSnapshot: null,
      calculateWidth() {
        state.ctx.font = "600 14px system-ui";
        const label = this.numbering ? `${this.numbering} ${this.text}` : this.text;
        const autoWidth = Math.min(MAX_NODE_TEXT_W, Math.max(100, state.ctx.measureText(label).width + 20));
        const requestedWidth = Number.isFinite(this.customWidth)
          ? Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, this.customWidth))
          : autoWidth;
        // Image attachments are allowed to establish a minimum width so they do not
        // spill outside the node when the text box is resized narrower.
        const imgInfo = getNodeFirstLoadedImage(this);
        if (imgInfo) {
          const { img } = imgInfo;
          const scale = Math.min(IMG_NODE_MAX_W / img.naturalWidth, IMG_NODE_MAX_H / img.naturalHeight, 1);
          return Math.max(requestedWidth, Math.round(img.naturalWidth * scale));
        }
        return requestedWidth;
      },
      draw(isGhost = false) {
        const theme = getBranchTheme(state);
        let depth = 0;
        let current = this.parent;
        while (current) {
          depth += 1;
          current = current.parent;
        }
        const paletteIndex = depth % theme.nodeFills.length;
        const palette = {
          fill: theme.nodeFills[paletteIndex],
          border: theme.nodeBorders[paletteIndex],
          text: theme.nodeTexts[paletteIndex]
        };
        this.width = this.calculateWidth();
        const label = this.numbering ? `${this.numbering} ${this.text}` : this.text;
        const lines = getWrappedLines(state.ctx, label, this.width);
        const TEXT_BOX_H = Math.max(40, lines.length * NODE_LINE_H + NODE_V_PAD);
        this.textBoxH = TEXT_BOX_H;
        if (this.attachments && this.attachments.length > 0) recomputeNodeHeight(this);
        else this.height = TEXT_BOX_H;

        if (!Number.isFinite(this.renderX)) this.renderX = this.x;
        if (!Number.isFinite(this.renderY)) this.renderY = this.y;

        state.ctx.globalAlpha = isGhost ? 0.4 : 1;
        const isSelected = this === state.selectedNode && !isGhost;
        state.ctx.fillStyle = isSelected ? "#2563eb" : "#ffffff";
        state.ctx.strokeStyle = isSelected ? "#1d4ed8" : "#d1d5db";
        state.ctx.lineWidth = isSelected ? 2.2 : this.collapsed ? 2 : 1.6;
        const radius = 10;
        const x = isGhost ? state.ghostX : this.renderX;
        const y = isGhost ? state.ghostY : this.renderY;

        state.ctx.beginPath();
        state.ctx.moveTo(x + radius, y);
        state.ctx.lineTo(x + this.width - radius, y);
        state.ctx.quadraticCurveTo(x + this.width, y, x + this.width, y + radius);
        state.ctx.lineTo(x + this.width, y + TEXT_BOX_H - radius);
        state.ctx.quadraticCurveTo(x + this.width, y + TEXT_BOX_H, x + this.width - radius, y + TEXT_BOX_H);
        state.ctx.lineTo(x + radius, y + TEXT_BOX_H);
        state.ctx.quadraticCurveTo(x, y + TEXT_BOX_H, x, y + TEXT_BOX_H - radius);
        state.ctx.lineTo(x, y + radius);
        state.ctx.quadraticCurveTo(x, y, x + radius, y);
        state.ctx.closePath();

        state.ctx.shadowColor = isSelected ? "rgba(37, 99, 235, 0.38)" : "rgba(15, 23, 42, 0.08)";
        state.ctx.shadowBlur = isSelected ? 12 : 5;
        state.ctx.shadowOffsetY = isSelected ? 3 : 2;
        state.ctx.fill();
        state.ctx.shadowColor = "transparent";
        state.ctx.stroke();

        state.ctx.fillStyle = isSelected ? "#ffffff" : "#1f2937";
        state.ctx.font = "600 14px system-ui";
        state.ctx.textAlign = "center";
        state.ctx.textBaseline = "middle";
        const lineStartY = y + (TEXT_BOX_H - lines.length * NODE_LINE_H) / 2 + NODE_LINE_H / 2;
        for (let i = 0; i < lines.length; i++) {
          state.ctx.fillText(lines[i], x + this.width / 2, lineStartY + i * NODE_LINE_H);
        }

        // Selected nodes expose a bottom-right resize handle. Dragging it changes
        // the node width; text is re-wrapped immediately for any script/language.
        if (isSelected) {
          const hs = NODE_RESIZE_HANDLE_SIZE;
          const hx = x + this.width - hs / 2;
          const hy = y + TEXT_BOX_H - hs / 2;
          state.ctx.save();
          state.ctx.fillStyle = "#ffffff";
          state.ctx.strokeStyle = "#2563eb";
          state.ctx.lineWidth = 1.6;
          state.ctx.beginPath();
          state.ctx.rect(hx, hy, hs, hs);
          state.ctx.fill();
          state.ctx.stroke();
          state.ctx.strokeStyle = "rgba(37, 99, 235, 0.9)";
          state.ctx.lineWidth = 1.2;
          state.ctx.beginPath();
          state.ctx.moveTo(hx + 4, hy + hs - 3);
          state.ctx.lineTo(hx + hs - 3, hy + 4);
          state.ctx.moveTo(hx + 7, hy + hs - 3);
          state.ctx.lineTo(hx + hs - 3, hy + 7);
          state.ctx.stroke();
          state.ctx.restore();
        }

        if (this.pinned && !isGhost) {
          state.ctx.fillStyle = "#0f766e";
          state.ctx.beginPath();
          state.ctx.arc(x + 10, y + 10, 4, 0, Math.PI * 2);
          state.ctx.fill();
        }
        state.ctx.globalAlpha = 1;
      },
      isInside(mx, my) {
        const hitX = Number.isFinite(this.renderX) ? this.renderX : this.x;
        const hitY = Number.isFinite(this.renderY) ? this.renderY : this.y;
        return mx >= hitX && mx <= hitX + this.width && my >= hitY && my <= hitY + this.height;
      }
    };
    node.width = node.calculateWidth();
    node.renderX = node.x;
    node.renderY = node.y;
    return node;
  }

  function toCanvasCoords(state, x, y) {
    return {
      x: (x - state.viewOffsetX) / state.viewScale,
      y: (y - state.viewOffsetY) / state.viewScale
    };
  }

  function showStatus(state, message, duration = 3000) {
    state.statusMessage.textContent = message;
    state.statusMessage.classList.add("visible");
    window.setTimeout(() => {
      state.statusMessage.classList.remove("visible");
    }, duration);
  }

  function setElementDisplay(element, value) {
    if (element) element.style.display = value;
  }

  function setElementCursor(element, value) {
    if (element) element.style.cursor = value;
  }

  function showLoading(state, text) {
    state.loadingText.textContent = text || "Loading...";
    setElementDisplay(state.loadingIndicator, "block");
  }

  function hideLoading(state) {
    setElementDisplay(state.loadingIndicator, "none");
  }

  function updateUndoButton(state) {
    state.undoBtn.disabled = state.history.length <= 1;
  }

  function updateDeleteButton(state) {
    const hasSelection = !!state.selectedNode;
    if (state.deleteBtn) state.deleteBtn.disabled = !hasSelection;
    if (state.focusBtn) state.focusBtn.disabled = !hasSelection;
    if (state.pinBtn) state.pinBtn.disabled = !hasSelection;
    if (state.collapseBtn) state.collapseBtn.disabled = !hasSelection || state.selectedNode.children.length === 0;
    updatePartButtons(state);
  }

  function updatePartButtons(state) {
    const node = state.selectedNode;
    if (state.savePartBtn) state.savePartBtn.disabled = !node || !!node.resolvedFromPart;
    if (state.pushPartBtn) state.pushPartBtn.disabled = !node || (!node.isGlobalPartSource && (!node.linkedPartId || !!node.resolvedFromPart || node.instanceState === "pinned"));
    if (state.pinRefBtn) {
      state.pinRefBtn.disabled = !node || !node.linkedPartId || !!node.resolvedFromPart;
      const isPinned = node && node.instanceState === "pinned";
      state.pinRefBtn.classList.toggle("pinned-active", !!isPinned);
      const lbl = state.pinRefBtn.querySelector(".button-label");
      if (lbl) lbl.textContent = isPinned ? "Unpin" : "Pin Ref";
    }
    if (state.tagBtn) state.tagBtn.disabled = !node;
    if (state.attachBtn) state.attachBtn.disabled = !node;
    if (state.noteBtn) state.noteBtn.disabled = !node;
    if (state.relLinkBtn) state.relLinkBtn.disabled = !node;
    if (state.aiBtn) state.aiBtn.disabled = !node;
  }

  function setUnsavedChanges(state, value) {
    state.hasUnsavedChanges = value;
    state.saveBtn.classList.toggle("highlight", state.hasUnsavedChanges);
  }

  function findNodeAt(state, mx, my) {
    for (const node of state.nodes) {
      if (node.isInside(mx, my)) return node;
    }
    return null;
  }

  function getNodeResizeHandleRect(node) {
    if (!node) return null;
    const x = Number.isFinite(node.renderX) ? node.renderX : node.x;
    const y = Number.isFinite(node.renderY) ? node.renderY : node.y;
    const h = node.textBoxH || 40;
    const size = NODE_RESIZE_HANDLE_SIZE;
    return {
      x: x + node.width - size / 2,
      y: y + h - size / 2,
      width: size,
      height: size
    };
  }

  function hitTestNodeResizeHandle(state, mx, my) {
    const node = state.selectedNode;
    if (!node || !state.visibleNodeIds.has(node.id)) return null;
    const r = getNodeResizeHandleRect(node);
    if (!r) return null;
    const padding = 4 / Math.max(0.25, state.viewScale || 1);
    return (
      mx >= r.x - padding && mx <= r.x + r.width + padding &&
      my >= r.y - padding && my <= r.y + r.height + padding
    ) ? node : null;
  }

  function finishNodeResize(state) {
    const node = state.resizingNode;
    const changed = !!node && state.resizeDidChange;
    state.resizingNode = null;
    state.resizeDidChange = false;
    setElementCursor(state.canvas, "");
    if (changed) {
      // If this is a resolved Global Part instance, push its edited geometry back
      // before autoLayout resolves the reference again.
      if (node.resolvedFromPart) {
        const refRoot = findLinkedRefRoot(node);
        if (refRoot) syncLinkedRefToRegistry(state, refRoot);
      }
      // Re-run layout once on release so child branches move to the resized edge.
      autoLayout(state);
      calculateInsertionZones(state);
      saveToHistory(state);
      state.lastDragEndAt = Date.now();
      showStatus(state, `Node width: ${Math.round(node.width)} px`);
    }
    requestDraw(state);
    updateDeleteButton(state);
  }

  // ── layout.js ──────────────────────────────────────────────────────────────

  // ── Multi-map helpers ─────────────────────────────────────────────────────

  function getActiveMap(state) {
    return state.maps.find((m) => m.id === state.activeMapId) || state.maps[0] || null;
  }

  function getActiveMapRoot(state) {
    const map = getActiveMap(state);
    if (!map) return null;
    return state.nodes.find((n) => n.id === map.rootId) || null;
  }

  function getNodeRootId(node) {
    let cur = node;
    while (cur.parent) cur = cur.parent;
    return cur.id;
  }

  function getMapForNode(state, node) {
    const rootId = getNodeRootId(node);
    return state.maps.find((m) => m.rootId === rootId) || null;
  }

  function getAllMapRoots(state) {
    return state.maps
      .map((m) => state.nodes.find((n) => n.id === m.rootId))
      .filter(Boolean);
  }

  function getRootNode(state) {
    return getActiveMapRoot(state) || state.nodes.find((n) => !n.parent) || null;
  }

  function getNodeById(state, nodeId) {
    return state.nodes.find((node) => node.id === nodeId) || null;
  }

  function getNodeLevel(node) {
    let level = 1;
    let current = node ? node.parent : null;
    while (current) { level += 1; current = current.parent; }
    return level;
  }

  function getVisibleChildren(node) {
    if (node.collapsed) return [];
    return node.children.filter((child) => !child._hiddenByLevel);
  }

  function getMaxMindmapLevel(state) {
    let maxLevel = 1;
    for (const node of state.nodes) maxLevel = Math.max(maxLevel, getNodeLevel(node));
    return maxLevel;
  }

  function updateLevelFilterControl(state) {
    const select = state.levelFilterSelect || document.getElementById("levelFilterSelect");
    if (!select) return;
    const maxLevel = getMaxMindmapLevel(state);
    if (select.dataset.maxLevel !== String(maxLevel)) {
      select.empty ? select.empty() : (select.innerHTML = "");
      const all = document.createElement("option");
      all.value = "all"; all.textContent = "All levels"; select.appendChild(all);
      for (let level = 1; level <= maxLevel; level++) {
        const option = document.createElement("option");
        option.value = String(level);
        option.textContent = level === 1 ? "Level 1 (root)" : `Levels 1–${level}`;
        select.appendChild(option);
      }
      select.dataset.maxLevel = String(maxLevel);
    }
    if (state.maxVisibleLevel != null && state.maxVisibleLevel > maxLevel) state.maxVisibleLevel = maxLevel;
    select.value = state.maxVisibleLevel == null ? "all" : String(state.maxVisibleLevel);
  }

  function applyLevelFilter(state) {
    const maxLevel = Number.isInteger(state.maxVisibleLevel) ? state.maxVisibleLevel : null;
    for (const node of state.nodes) {
      node._hiddenByLevel = maxLevel !== null && getNodeLevel(node) > maxLevel;
    }
    updateLevelFilterControl(state);
  }

  function isDescendantOrSelf(node, ancestor) {
    if (!node || !ancestor) return false;
    let current = node;
    while (current) {
      if (current === ancestor) return true;
      current = current.parent;
    }
    return false;
  }

  function traverseVisible(root, visit) {
    if (!root) return;
    visit(root);
    for (const child of getVisibleChildren(root)) {
      traverseVisible(child, visit);
    }
  }

  function countVisibleLeaves(node) {
    const visibleChildren = getVisibleChildren(node);
    if (visibleChildren.length === 0) return 1;
    return visibleChildren.map(countVisibleLeaves).reduce((a, b) => a + b, 0);
  }

  function collectVisibleNodes(state) {
    const nodes = [];
    const roots = state.maps.length > 0 ? getAllMapRoots(state) : [state.nodes.find((n) => !n.parent)].filter(Boolean);
    for (const root of roots) traverseVisible(root, (node) => nodes.push(node));
    return nodes;
  }

  function collectVisibleLinks(state) {
    const links = [];
    const roots = state.maps.length > 0 ? getAllMapRoots(state) : [state.nodes.find((n) => !n.parent)].filter(Boolean);
    for (const root of roots) {
      traverseVisible(root, (node) => {
        if (node.collapsed) return;
        // Only draw links whose child is currently visible. Using node.children here
        // caused a short purple connector to remain when a level filter hid the
        // next level, because the hidden child still kept its previous coordinates.
        for (const child of getVisibleChildren(node)) {
          links.push({ from: node, to: child });
        }
      });
    }
    return links;
  }

  function rebuildVisibilityCaches(state) {
    const visibleNodes = collectVisibleNodes(state);
    const visibleLinks = collectVisibleLinks(state);
    state.visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    state.visibleLinkKeys = new Set(visibleLinks.map((link) => `${link.from.id}->${link.to.id}`));
    return { visibleNodes, visibleLinks };
  }

  function layoutHorizontal(state, root, { spacingY, horizontalPadding, baseX, centerY }) {
    // Before computing positions, sync every node's height from the image cache
    // and file badge count. When resolveLinkedNodes tears down old resolved nodes
    // and creates new ones, the new nodes start with height=40. The images are
    // already in _imgCache so img.onload never fires again — we must update the
    // height here synchronously. recomputeNodeHeight covers images + file badges.
    for (const node of state.nodes) {
      if (node.attachments && node.attachments.length > 0) recomputeNodeHeight(node);
    }
    for (const node of state.nodes) {
      node.width = node.calculateWidth();
    }
    const useCenterY = Number.isFinite(centerY) ? centerY : state.canvas.height / 2;

    // Sum actual leaf heights (including images) for accurate initial centering
    function totalLeafHeight(node) {
      const children = getVisibleChildren(node);
      if (children.length === 0) return node.height + spacingY;
      return children.reduce((sum, child) => sum + totalLeafHeight(child), 0);
    }
    const yRef = { value: useCenterY - totalLeafHeight(root) / 2 };

    function layoutNode(node, depth = 0) {
      if (!node.pinned) {
        if (node.parent) {
          node.x = node.parent.x + node.parent.width + horizontalPadding + depth * 2;
        } else {
          node.x = baseX;
        }
      }
      const visibleChildren = getVisibleChildren(node);
      if (visibleChildren.length === 0) {
        if (!node.pinned) node.y = yRef.value;
        yRef.value += node.height + spacingY;
        return node.y;
      }
      const childYs = visibleChildren.map((child) => layoutNode(child, depth + 1));
      const avgY = childYs.reduce((a, b) => a + b, 0) / childYs.length;
      if (!node.pinned) node.y = avgY;
      // If this internal node has an image that extends below its children's space,
      // push yRef down so the next sibling subtree clears the image bottom.
      const nodeBottom = node.y + node.height + spacingY;
      if (nodeBottom > yRef.value) yRef.value = nodeBottom;
      return node.y;
    }
    layoutNode(root);
  }

  function layoutRadial(state, root) {
    for (const node of state.nodes) {
      node.width = node.calculateWidth();
      if (node.attachments && node.attachments.length > 0) recomputeNodeHeight(node);
    }
    const centerX = state.canvas.width * 0.45;
    const centerY = state.canvas.height * 0.5;
    const radiusStep = 120;

    function assignPolar(node, startAngle, endAngle, depth) {
      const angle = (startAngle + endAngle) / 2;
      const radius = depth * radiusStep;
      if (!node.pinned) {
        if (depth === 0) {
          node.x = centerX;
          node.y = centerY;
        } else {
          node.x = centerX + Math.cos(angle) * radius;
          node.y = centerY + Math.sin(angle) * radius;
        }
      }
      const visibleChildren = getVisibleChildren(node);
      if (visibleChildren.length === 0) return;
      const totalLeaves = visibleChildren.map((child) => countVisibleLeaves(child)).reduce((a, b) => a + b, 0);
      let cursor = startAngle;
      for (const child of visibleChildren) {
        const childLeaves = countVisibleLeaves(child);
        const span = ((endAngle - startAngle) * childLeaves) / totalLeaves;
        assignPolar(child, cursor, cursor + span, depth + 1);
        cursor += span;
      }
    }
    assignPolar(root, -Math.PI * 0.85, Math.PI * 0.85, 0);
  }

  function runLayoutForMode(state, root, centerY) {
    if (state.layoutMode === "radial") {
      layoutRadial(state, root);
      return;
    }
    if (state.layoutMode === "compact") {
      layoutHorizontal(state, root, { spacingY: 36, horizontalPadding: 28, baseX: 90, centerY });
      return;
    }
    layoutHorizontal(state, root, { spacingY: 60, horizontalPadding: 40, baseX: 100, centerY });
  }

  function autoNumberNodes(state) {
    // Numbering system disabled — clear any stored numbering on all nodes.
    for (const node of state.nodes) {
      node.numbering = "";
    }
  }

  // Vertical slot height per map on the canvas (px in world coords)
  const MAP_SLOT_HEIGHT = 900;

  function autoLayout(state) {
    resolveLinkedNodes(state);
    applyLevelFilter(state);
    if (state.maps.length > 0) {
      for (let i = 0; i < state.maps.length; i++) {
        const map = state.maps[i];
        const root = state.nodes.find((n) => n.id === map.rootId);
        if (!root) continue;
        const centerY = (i + 0.5) * MAP_SLOT_HEIGHT;
        runLayoutForMode(state, root, centerY);
      }
    } else {
      // Legacy single-map fallback
      const root = state.nodes.find((n) => !n.parent);
      if (root) runLayoutForMode(state, root, state.canvas.height / 2);
    }
    autoNumberNodes(state);
    rebuildVisibilityCaches(state);
  }

  function calculateInsertionZones(state) {
    rebuildVisibilityCaches(state);
    state.nodeZones = [];
    const childrenByParent = new Map();

    state.nodes.forEach((node) => {
      if (!state.visibleNodeIds.has(node.id)) return;
      if (node.parent) {
        if (node.parent.collapsed) return;
        if (!childrenByParent.has(node.parent)) childrenByParent.set(node.parent, []);
        childrenByParent.get(node.parent).push(node);
      }
    });

    childrenByParent.forEach((children, parent) => {
      const sortedChildren = [...children].sort((a, b) => a.y - b.y);
      const standardZoneHeight = 30;

      sortedChildren.forEach((child, index) => {
        const isLastChild = index === sortedChildren.length - 1;
        const isFirstChild = index === 0;
        const zoneWidth = child.x - (parent.x + parent.width) + child.width;

        state.nodeZones.push({
          type: "before",
          parent,
          targetNode: child,
          actualIndex: parent.children.indexOf(child),
          x: parent.x + parent.width,
          y: child.y - standardZoneHeight,
          width: zoneWidth,
          height: standardZoneHeight,
          color: "rgba(255, 0, 0, 0.2)"
        });

        if (!isFirstChild) {
          const prevChild = sortedChildren[index - 1];
          const gapStart = prevChild.y + prevChild.height + standardZoneHeight;
          const gapEnd = child.y - standardZoneHeight;
          if (gapEnd > gapStart) {
            state.nodeZones.push({
              type: "extended-before",
              parent,
              targetNode: child,
              actualIndex: parent.children.indexOf(child),
              x: parent.x + parent.width,
              y: gapStart,
              width: zoneWidth,
              height: gapEnd - gapStart,
              color: "rgba(255, 0, 0, 0.2)"
            });
          }
        }

        if (isLastChild) {
          state.nodeZones.push({
            type: "after",
            parent,
            targetNode: child,
            actualIndex: parent.children.length,
            x: parent.x + parent.width,
            y: child.y + child.height,
            width: zoneWidth,
            height: standardZoneHeight,
            color: "rgba(0, 255, 0, 0.2)"
          });
        }
      });
    });

    state.nodes.forEach((node) => {
      if (!state.visibleNodeIds.has(node.id)) return;
      if (node.children.length === 0 || node.collapsed) {
        state.nodeZones.push({
          type: "child",
          parent: node,
          targetNode: null,
          actualIndex: 0,
          x: node.x + node.width,
          y: node.y,
          width: node.width,
          height: node.height,
          color: "rgba(255, 255, 0, 0.15)"
        });
      }
    });
  }

  function getVisibleNodes(state) {
    return collectVisibleNodes(state);
  }

  function getVisibleLinks(state) {
    return collectVisibleLinks(state);
  }

  function getFocusNode(state) {
    return state.focusNodeId === null ? null : getNodeById(state, state.focusNodeId);
  }

  function isNodeDimmedByFocus(state, node) {
    const focusNode = getFocusNode(state);
    if (!focusNode) return false;
    return !isDescendantOrSelf(node, focusNode);
  }

  function isLinkDimmedByFocus(state, fromNode, toNode) {
    const focusNode = getFocusNode(state);
    if (!focusNode) return false;
    return !(isDescendantOrSelf(fromNode, focusNode) && isDescendantOrSelf(toNode, focusNode));
  }

  function countHiddenDescendants(node) {
    let total = 0;
    function walk(current) {
      for (const child of current.children) {
        total += 1;
        walk(child);
      }
    }
    walk(node);
    return total;
  }

  function centerMindmap(state, requestDrawFn) {
    if (state.nodes.length === 0) return;
    const rootNode = getRootNode(state);
    if (!rootNode) return;
    const focusNode = getFocusNode(state);
    const anchorNode = focusNode || rootNode;
    // Collect visible nodes for active map only (for Y-range calculation)
    const activeMapNodes = [];
    traverseVisible(rootNode, (n) => activeMapNodes.push(n));
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of activeMapNodes) {
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y + node.height);
    }
    const mindmapCenterY = (minY + maxY) / 2;
    const canvasCenterY = state.canvas.height / 2;
    const leftPadding = state.canvas.width * 0.15;
    state.viewOffsetX = leftPadding - anchorNode.x * state.viewScale;
    state.viewOffsetY = canvasCenterY - mindmapCenterY * state.viewScale;
    requestDrawFn();
    const now = Date.now();
    state.centerButtonClicks.push(now);
    state.centerButtonClicks = state.centerButtonClicks.filter((timestamp) => now - timestamp < 3000);
    if (state.centerButtonClicks.length >= 5) {
      state.debugShowZones = !state.debugShowZones;
      state.centerButtonClicks = [];
      showStatus(state, state.debugShowZones ? "Debug zones enabled" : "Debug zones disabled");
      requestDrawFn();
    }
  }

  // ── rendering.js ───────────────────────────────────────────────────────────

  function drawRoundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function getNodeRenderPosition(node) {
    return {
      x: Number.isFinite(node.renderX) ? node.renderX : node.x,
      y: Number.isFinite(node.renderY) ? node.renderY : node.y
    };
  }

  function updateLayoutTransition(state) {
    let stillMoving = false;
    for (const node of state.nodes) {
      if (!Number.isFinite(node.renderX)) node.renderX = node.x;
      if (!Number.isFinite(node.renderY)) node.renderY = node.y;
      if (!state.layoutTransitionActive) {
        node.renderX = node.x;
        node.renderY = node.y;
        continue;
      }
      const dx = node.x - node.renderX;
      const dy = node.y - node.renderY;
      if (Math.abs(dx) < 0.35 && Math.abs(dy) < 0.35) {
        node.renderX = node.x;
        node.renderY = node.y;
        continue;
      }
      node.renderX += dx * 0.22;
      node.renderY += dy * 0.22;
      stillMoving = true;
    }
    if (state.layoutTransitionActive && !stillMoving) {
      state.layoutTransitionActive = false;
    }
    return stillMoving;
  }

  function drawLine(state, from, to, dimmed = false) {
    const fromPos = getNodeRenderPosition(from);
    const toPos = getNodeRenderPosition(to);
    const x1 = fromPos.x + from.width;
    const y1 = fromPos.y + (from.textBoxH || 40) / 2;
    const x2 = toPos.x;
    const y2 = toPos.y + (to.textBoxH || 40) / 2;
    const cp1x = x1 + 40;
    const cp2x = x2 - 40;
    // Compute depth via parent traversal so link colours work without numbering.
    let fromDepth = 0;
    let depthCursor = from.parent;
    while (depthCursor) { fromDepth++; depthCursor = depthCursor.parent; }
    const theme = getBranchTheme(state);
    state.ctx.strokeStyle = dimmed
      ? "rgba(148, 163, 184, 0.2)"
      : "#7c3aed";
    state.ctx.lineWidth = dimmed ? 1 : 2.3;
    state.ctx.beginPath();
    state.ctx.moveTo(x1, y1);
    state.ctx.bezierCurveTo(cp1x, y1, cp2x, y2, x2, y2);
    state.ctx.stroke();
  }

  function drawNodeSummary(state, node) {
    if (node.children.length === 0 || !node.collapsed) return;
    const nodePos = getNodeRenderPosition(node);
    const previewItems = node.children.slice(0, 2).map((child) => child.text);
    const hiddenDescendants = countHiddenDescendants(node);
    const moreCount = Math.max(hiddenDescendants - previewItems.length, 0);
    const previewText = `${previewItems.join(", ")}${moreCount > 0 ? ` +${moreCount}` : ""}`;
    state.ctx.fillStyle = "rgba(30, 41, 59, 0.84)";
    state.ctx.font = "600 11px system-ui";
    state.ctx.textAlign = "left";
    state.ctx.textBaseline = "middle";
    state.ctx.fillText(previewText, nodePos.x + node.width + 10, nodePos.y + 20);
  }

  function drawPinnedMarker(state, node) {
    if (!node.pinned) return;
    state.ctx.fillStyle = "#0f766e";
    state.ctx.font = "700 12px system-ui";
    state.ctx.textAlign = "left";
    state.ctx.textBaseline = "top";
    const nodePos = getNodeRenderPosition(node);
    state.ctx.fillText("P", nodePos.x + 6, nodePos.y + 4);
  }

  // Cache for decoded HTMLImageElement objects keyed by attachment id.
  const _imgCache = new Map();

  // ── IndexedDB store for attachment data (bypasses ~5 MB localStorage quota) ──
  const _idb = (() => {
    const DB_NAME = "mindmap_attach_v1";
    const STORE = "data";
    let _dbPromise = null;
    function open() {
      if (_dbPromise) return _dbPromise;
      _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => { _dbPromise = null; reject(req.error); };
      });
      return _dbPromise;
    }
    return {
      put(id, data) {
        open().then((db) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put({ id, data });
        }).catch(() => {});
      },
      remove(id) {
        open().then((db) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(id);
        }).catch(() => {});
      },
      getAll() {
        return open().then((db) => new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readonly");
          const req = tx.objectStore(STORE).getAll();
          req.onsuccess = () => {
            const map = new Map();
            for (const entry of req.result) map.set(entry.id, entry.data);
            resolve(map);
          };
          req.onerror = () => reject(req.error);
        })).catch(() => new Map());
      }
    };
  })();

  // ── Attachment data persistence ─────────────────────────────────────────
  // Primary: per-key localStorage (synchronous, survives refresh instantly).
  // Fallback: IndexedDB (async, for files too large for localStorage quota).

  function _attachKey(id) { return "mindmap.att." + id; }

  function _persistAttach(id, data) {
    if (IS_OBSIDIAN) return;
    // Try localStorage first — synchronous and reliable.
    try {
      if (canUseLocalStorage()) {
        window.localStorage.setItem(_attachKey(id), data);
        return;
      }
    } catch { /* QuotaExceededError — fall through to IDB */ }
    _idb.put(id, data);
  }

  function _dropAttach(id) {
    if (IS_OBSIDIAN) return;
    try { if (canUseLocalStorage()) window.localStorage.removeItem(_attachKey(id)); } catch {}
    _idb.remove(id);
  }

  // Restore att.data for all stripped attachments after loading from autosave.
  // Synchronous for localStorage hits; also fires an async IDB sweep for any
  // large files that were stored there instead.
  function reinflateAttachments(state) {
    if (IS_OBSIDIAN) return;
    let changed = false;
    for (const node of state.nodes) {
      if (!node.attachments) continue;
      for (const att of node.attachments) {
        if (att.data) continue;
        let data = null;
        try { if (canUseLocalStorage()) data = window.localStorage.getItem(_attachKey(att.id)); } catch {}
        if (data) {
          _imgCache.delete(att.id);
          att.data = data;
          changed = true;
        }
      }
    }
    if (changed) { autoLayout(state); requestDraw(state); }
    // Async IDB sweep for anything still missing (files that exceeded localStorage quota).
    _idb.getAll().then((dataMap) => {
      if (dataMap.size === 0) return;
      let idbChanged = false;
      for (const node of state.nodes) {
        if (!node.attachments) continue;
        for (const att of node.attachments) {
          if (!att.data && dataMap.has(att.id)) {
            _imgCache.delete(att.id);
            att.data = dataMap.get(att.id);
            idbChanged = true;
          }
        }
      }
      if (idbChanged) { autoLayout(state); requestDraw(state); }
    });
  }

  // Max dimensions for an image-mode node (image replaces the text box).
  const IMG_NODE_MAX_W = 300;
  const IMG_NODE_MAX_H = 240;

  // File badge geometry (non-image attachments drawn below the text box / images).
  const FILE_BADGE_H = 26;         // height of each badge pill
  const FILE_BADGE_GAP = 4;        // gap between consecutive badges
  const FILE_ATTACH_TOP_GAP = 8;   // gap between last image (or text box) and first badge

  // Returns all non-image attachments for a node.
  function getNodeFileAtts(node) {
    if (!node.attachments || node.attachments.length === 0) return [];
    return node.attachments.filter((a) => a.type && !a.type.startsWith("image/"));
  }

  // Extra height contributed by file badges (0 when none).
  function getNodeFileBadgesHeight(node) {
    const count = getNodeFileAtts(node).length;
    if (count === 0) return 0;
    return FILE_ATTACH_TOP_GAP + count * FILE_BADGE_H + (count - 1) * FILE_BADGE_GAP;
  }

  // Recomputes node.height from currently-cached images and file badges.
  // Call whenever image cache changes or file attachments are added/removed.
  function recomputeNodeHeight(node) {
    const TEXT_H = node.textBoxH || 40;
    const IMG_GAP = 8;
    let h = TEXT_H;
    if (node.attachments && node.attachments.length > 0) {
      const imageAtts = node.attachments.filter((a) => a.type && a.type.startsWith("image/"));
      for (const att of imageAtts) {
        const img = _imgCache.get(att.id);
        if (!img || !img.complete || img.naturalWidth === 0) continue;
        const scale = Math.min(IMG_NODE_MAX_W / img.naturalWidth, IMG_NODE_MAX_H / img.naturalHeight, 1);
        h += IMG_GAP + Math.round(img.naturalHeight * scale);
      }
      h += getNodeFileBadgesHeight(node);
    }
    node.height = h;
  }

  // Returns {img, att} for the first image attachment that is fully loaded,
  // or null if none exists or the first image attachment hasn't loaded yet.
  function getNodeFirstLoadedImage(node) {
    if (!node.attachments || node.attachments.length === 0) return null;
    for (const att of node.attachments) {
      if (!att.type || !att.type.startsWith("image/")) continue;
      const img = _imgCache.get(att.id);
      if (img && img.complete && img.naturalWidth > 0) return { img, att };
      return null; // first image att found but not yet decoded
    }
    return null;
  }

  function _getCachedImg(state, att) {
    if (!att.data) return null;  // data not yet inflated — do not cache a broken image
    if (_imgCache.has(att.id)) return _imgCache.get(att.id);
    const img = new Image();
    img.onload = () => {
      const ownerNode = state.nodes.find(
        (n) => n.attachments && n.attachments.some((a) => a.id === att.id)
      );
      if (ownerNode) {
        recomputeNodeHeight(ownerNode);
      }
      autoLayout(state);
      requestDraw(state);
    };
    img.src = att.data;
    _imgCache.set(att.id, img);
    return img;
  }

  function drawNodeAttachmentImages(state, node) {
    if (!node.attachments || node.attachments.length === 0) return;
    const imageAtts = node.attachments.filter((a) => a.type && a.type.startsWith("image/"));
    if (imageAtts.length === 0) return;

    const nodePos = getNodeRenderPosition(node);
    const IMG_GAP = 8;       // gap between text box and image
    const TEXT_H = node.textBoxH || 40;
    const RADIUS = 8;
    const MAX_W = IMG_NODE_MAX_W;
    const MAX_H = IMG_NODE_MAX_H;

    // Draw images stacked below the text box, each centered under the node
    let stackY = nodePos.y + TEXT_H + IMG_GAP;

    for (const att of imageAtts) {
      const img = _getCachedImg(state, att);
      if (!img || !img.complete || img.naturalWidth === 0) continue;

      const scale = Math.min(MAX_W / img.naturalWidth, MAX_H / img.naturalHeight, 1);
      const iw = Math.round(img.naturalWidth * scale);
      const ih = Math.round(img.naturalHeight * scale);

      // Center horizontally under the text box
      const ix = nodePos.x + (node.width - iw) / 2;

      // Clip to rounded rect and draw image
      state.ctx.save();
      drawRoundedRectPath(state.ctx, ix, stackY, iw, ih, RADIUS);
      state.ctx.clip();
      state.ctx.drawImage(img, ix, stackY, iw, ih);
      state.ctx.restore();

      // Thin border
      state.ctx.save();
      state.ctx.strokeStyle = "rgba(15, 23, 42, 0.15)";
      state.ctx.lineWidth = 1;
      drawRoundedRectPath(state.ctx, ix, stackY, iw, ih, RADIUS);
      state.ctx.stroke();
      state.ctx.restore();

      stackY += ih + IMG_GAP;
    }
  }

  function drawNodeFileAttachments(state, node) {
    const fileAtts = getNodeFileAtts(node);
    if (fileAtts.length === 0) return;

    const nodePos = getNodeRenderPosition(node);
    const TEXT_H = node.textBoxH || 40;
    const IMG_GAP = 8;

    // Compute Y after all loaded images (same stacking as drawNodeAttachmentImages)
    let stackY = nodePos.y + TEXT_H;
    if (node.attachments) {
      const imageAtts = node.attachments.filter((a) => a.type && a.type.startsWith("image/"));
      for (const att of imageAtts) {
        const img = _imgCache.get(att.id);
        if (!img || !img.complete || img.naturalWidth === 0) continue;
        const scale = Math.min(IMG_NODE_MAX_W / img.naturalWidth, IMG_NODE_MAX_H / img.naturalHeight, 1);
        stackY += IMG_GAP + Math.round(img.naturalHeight * scale);
      }
    }
    stackY += FILE_ATTACH_TOP_GAP;

    // Icon background colour by MIME type
    function badgeIconColor(type) {
      if (!type) return "#475569";
      if (type === "application/pdf") return "#dc2626";
      if (type.includes("spreadsheet") || type.includes("excel") || type === "text/csv") return "#16a34a";
      if (type.includes("wordprocessing") || type === "application/msword") return "#2563eb";
      if (type.includes("presentation") || type.includes("powerpoint")) return "#ea580c";
      if (type.startsWith("text/")) return "#6b7280";
      if (type.startsWith("video/")) return "#7c3aed";
      if (type.startsWith("audio/")) return "#0891b2";
      return "#475569";
    }

    const ICON_W = 36;
    const RADIUS = 6;
    const ctx = state.ctx;

    for (const att of fileAtts) {
      const bx = nodePos.x;
      const by = stackY;
      const bw = node.width;

      // Badge background
      ctx.save();
      ctx.fillStyle = "#f8fafc";
      ctx.strokeStyle = "rgba(15,23,42,0.12)";
      ctx.lineWidth = 1;
      drawRoundedRectPath(ctx, bx, by, bw, FILE_BADGE_H, RADIUS);
      ctx.fill();
      ctx.stroke();

      // Icon square (left side)
      const iconColor = badgeIconColor(att.type);
      ctx.fillStyle = iconColor;
      drawRoundedRectPath(ctx, bx + 4, by + 3, ICON_W - 4, FILE_BADGE_H - 6, 4);
      ctx.fill();

      // Extension label inside icon
      const ext = att.name ? att.name.split(".").pop().toUpperCase().slice(0, 4) : "FILE";
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ext, bx + 4 + (ICON_W - 4) / 2, by + FILE_BADGE_H / 2);

      // Filename (truncated to fit remaining width)
      const textX = bx + ICON_W + 6;
      const maxTextW = bw - ICON_W - 14;
      ctx.fillStyle = "#1e293b";
      ctx.font = "500 11px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      // Truncate to fit
      let label = att.name || ("file_" + att.id);
      while (label.length > 4 && ctx.measureText(label).width > maxTextW) {
        label = label.slice(0, -4) + "\u2026";
      }
      ctx.fillText(label, textX, by + FILE_BADGE_H / 2);
      ctx.restore();

      stackY += FILE_BADGE_H + FILE_BADGE_GAP;
    }
  }

  function updateReorderButtons(state) {
    if (!state.selectedNode || state.isDragging) {
      setElementDisplay(state.reorderUp, "none");
      setElementDisplay(state.reorderDown, "none");
      if (state.nodeContextPanel) state.nodeContextPanel.classList.remove("visible");
      return;
    }
    const x =
      state.selectedNode.x * state.viewScale +
      state.viewOffsetX +
      state.selectedNode.width * state.viewScale +
      5;
    const y = state.selectedNode.y * state.viewScale + state.viewOffsetY;
    setElementDisplay(state.reorderUp, "block");
    setElementDisplay(state.reorderDown, "block");
    state.reorderUp.style.left = `${x}px`;
    state.reorderUp.style.top = `${y}px`;
    state.reorderDown.style.left = `${x}px`;
    state.reorderDown.style.top = `${y + 20}px`;

    // Position the node context panel centered above the selected node
    if (state.nodeContextPanel) {
      const nodeScreenX = state.selectedNode.x * state.viewScale + state.viewOffsetX + (state.selectedNode.width * state.viewScale) / 2;
      const nodeScreenY = state.selectedNode.y * state.viewScale + state.viewOffsetY;
      state.nodeContextPanel.style.left = `${nodeScreenX}px`;
      state.nodeContextPanel.style.top = `${nodeScreenY}px`;
      state.nodeContextPanel.classList.add("visible");
    }
  }

  function drawAll(state) {
    const transitioning = updateLayoutTransition(state);
    state.ctx.setTransform(state.viewScale, 0, 0, state.viewScale, state.viewOffsetX, state.viewOffsetY);
    state.ctx.clearRect(
      -state.viewOffsetX / state.viewScale,
      -state.viewOffsetY / state.viewScale,
      state.canvas.width / state.viewScale,
      state.canvas.height / state.viewScale
    );

    calculateInsertionZones(state);

    if (state.debugShowZones) {
      for (const zone of state.nodeZones) {
        state.ctx.fillStyle = zone.color;
        state.ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
        state.ctx.fillStyle = "black";
        state.ctx.font = "10px sans-serif";
        state.ctx.textAlign = "center";
        state.ctx.fillText(zone.type, zone.x + zone.width / 2, zone.y + zone.height / 2);
      }
    }

    const visibleLinks = getVisibleLinks(state);
    for (const link of visibleLinks) {
      const linkDimmed = isLinkDimmedByFocus(state, link.from, link.to);
      drawLine(state, link.from, link.to, linkDimmed);
    }

    const visibleNodes = getVisibleNodes(state);
    for (const node of visibleNodes) {
      const dimmed = isNodeDimmedByFocus(state, node);
      if (state.searchMatchIds.size > 0 && state.searchMatchIds.has(node.id)) {
        const pos = getNodeRenderPosition(node);
        const pad = 4;
        state.ctx.save();
        state.ctx.strokeStyle = "#f59e0b";
        state.ctx.lineWidth = 2.5;
        state.ctx.shadowColor = "rgba(245, 158, 11, 0.6)";
        state.ctx.shadowBlur = 10;
        drawRoundedRectPath(state.ctx, pos.x - pad, pos.y - pad, node.width + pad * 2, 40 + pad * 2, 14);
        state.ctx.stroke();
        state.ctx.restore();
      }
      if (dimmed) state.ctx.globalAlpha = 0.2;
      node.draw(false);
      state.ctx.globalAlpha = 1;
      if (!node.isGlobalPartSource && !node.linkedPartId) {
        drawNodeSummary(state, node);
      }
      drawPinnedMarker(state, node);

      // Global part visual indicators
      const gpos = getNodeRenderPosition(node);
      if (node.isGlobalPartSource || node.linkedPartId) {
        const isPinned = node.instanceState === "pinned";
        const color = node.isGlobalPartSource ? "#16a34a" : (isPinned ? "#d97706" : "#16a34a");
        const borderColor = isPinned ? "#d97706" : "#16a34a";
        if (node.linkedPartId) {
          state.ctx.save();
          state.ctx.strokeStyle = borderColor;
          state.ctx.lineWidth = 1.8;
          state.ctx.setLineDash([4, 3]);
          drawRoundedRectPath(state.ctx, gpos.x - 3, gpos.y - 3, node.width + 6, 40 + 6, 13);
          state.ctx.stroke();
          state.ctx.setLineDash([]);
          state.ctx.restore();
        } else {
          state.ctx.save();
          state.ctx.strokeStyle = color;
          state.ctx.lineWidth = 2;
          state.ctx.shadowColor = "rgba(22, 163, 74, 0.45)";
          state.ctx.shadowBlur = 8;
          drawRoundedRectPath(state.ctx, gpos.x - 3, gpos.y - 3, node.width + 6, 40 + 6, 13);
          state.ctx.stroke();
          state.ctx.restore();
        }
      }
      if (node.resolvedFromPart) {
        state.ctx.fillStyle = "rgba(22, 163, 74, 0.75)";
        state.ctx.beginPath();
        state.ctx.arc(gpos.x + node.width - 6, gpos.y + 6, 3.5, 0, Math.PI * 2);
        state.ctx.fill();
      }
      // Tag indicator: small amber dot at top-left if node has tags
      if (node.tags && node.tags.length > 0) {
        state.ctx.fillStyle = "#f59e0b";
        state.ctx.beginPath();
        state.ctx.arc(gpos.x + 7, gpos.y + 7, 3.5, 0, Math.PI * 2);
        state.ctx.fill();
      }
      // Attachment indicator: small purple dot at bottom-right of text box if node has attachments
      if (node.attachments && node.attachments.length > 0) {
        state.ctx.fillStyle = "#7c3aed";
        state.ctx.beginPath();
        state.ctx.arc(gpos.x + node.width - 7, gpos.y + 40 - 7, 3.5, 0, Math.PI * 2);
        state.ctx.fill();
      }
      // Note indicator: small teal dot at top-right for inline or linked Markdown notes
      if (node.note || node.noteFilePath) {
        state.ctx.fillStyle = "#0891b2";
        state.ctx.beginPath();
        state.ctx.arc(gpos.x + node.width - 7, gpos.y + 7, 3.5, 0, Math.PI * 2);
        state.ctx.fill();
      }
      // Links indicator: small orange dot above note dot if node has URL links
      if (node.links && node.links.length > 0) {
        state.ctx.fillStyle = "#ea580c";
        state.ctx.beginPath();
        state.ctx.arc(gpos.x + node.width - 16, gpos.y + 7, 3.5, 0, Math.PI * 2);
        state.ctx.fill();
      }
      // Draw image attachments below the text box
      drawNodeAttachmentImages(state, node);
      // Draw non-image file badges below images
      drawNodeFileAttachments(state, node);
      // Warm the image cache for image attachments (triggers async decode + layout update).
      if (node.attachments) {
        for (const att of node.attachments) {
          if (att.data && att.type && att.type.startsWith("image/")) _getCachedImg(state, att);
        }
      }
    }

    // Relationship lines drawn on top of all nodes so they are always visible
    drawRelLines(state);

    // Live green drawing preview while in pick mode
    if (state.relLinePickMode && state.relLineSourceId != null && state.relLineMouseX != null) {
      const srcNode = state.nodes.find((n) => n.id === state.relLineSourceId);
      if (srcNode) {
        const fp = getNodeRenderPosition(srcNode);
        const mx = state.relLineMouseX;
        const my = state.relLineMouseY;
        const fcx = fp.x + srcNode.width / 2;
        const fcy = fp.y + srcNode.height / 2;
        const dx = mx - fcx, dy = my - fcy;
        const adx = Math.abs(dx), ady = Math.abs(dy);
        let fx, fy;
        if (adx > ady * (srcNode.width / 40)) {
          fx = dx >= 0 ? fp.x + srcNode.width : fp.x;
          fy = fcy;
        } else {
          fx = fcx;
          fy = dy >= 0 ? fp.y + srcNode.height : fp.y;
        }
        const ldx = mx - fx, ldy = my - fy;
        const ldist = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
        const arcH = Math.min(ldist * 0.5, 250);
        const cpx = (fx + mx) / 2 + (ldy / ldist) * arcH;
        const cpy = (fy + my) / 2 + (-ldx / ldist) * arcH;
        state.ctx.save();
        state.ctx.strokeStyle = "#16a34a";
        state.ctx.lineWidth = 2.2;
        state.ctx.setLineDash([9, 5]);
        state.ctx.lineCap = "round";
        state.ctx.globalAlpha = 0.82;
        state.ctx.shadowColor = "rgba(22, 163, 74, 0.45)";
        state.ctx.shadowBlur = 6;
        state.ctx.beginPath();
        state.ctx.moveTo(fx, fy);
        state.ctx.quadraticCurveTo(cpx, cpy, mx, my);
        state.ctx.stroke();
        state.ctx.setLineDash([]);
        state.ctx.shadowBlur = 0;
        drawArrowhead(state.ctx, mx, my, mx - cpx, my - cpy, 10, "#16a34a");
        state.ctx.restore();
      }
    }

    if (state.isDragging && state.draggingNode && state.showGhostNode) {
      state.ctx.globalAlpha = 0.5;
      state.draggingNode.draw(true);
      state.ctx.globalAlpha = 1;
      if (state.potentialParent) {
        state.ctx.strokeStyle = "#007bff";
        state.ctx.lineWidth = 2;
        state.ctx.setLineDash([5, 3]);
        const startX = state.potentialParent.x + state.potentialParent.width;
        const startY = state.potentialParent.y + 20;
        const endX = state.ghostX;
        const endY = state.ghostY + 20;
        const cp1x = startX + 40;
        const cp2x = endX - 40;
        state.ctx.beginPath();
        state.ctx.moveTo(startX, startY);
        state.ctx.bezierCurveTo(cp1x, startY, cp2x, endY, endX, endY);
        state.ctx.stroke();
        state.ctx.setLineDash([]);
      }
    }

    // Draw map name banners above each map's root node
    if (state.maps.length > 1) {
      for (const map of state.maps) {
        const mapRoot = state.nodes.find((n) => n.id === map.rootId);
        if (!mapRoot) continue;
        const rpos = getNodeRenderPosition(mapRoot);
        const isActive = map.id === state.activeMapId;
        const label = map.name;
        state.ctx.save();
        state.ctx.font = "700 13px system-ui";
        const labelW = state.ctx.measureText(label).width + 24;
        const bannerX = rpos.x;
        const bannerY = rpos.y - 46;
        state.ctx.fillStyle = isActive ? "rgba(79,70,229,0.12)" : "rgba(148,163,184,0.10)";
        drawRoundedRectPath(state.ctx, bannerX, bannerY, labelW, 28, 8);
        state.ctx.fill();
        state.ctx.strokeStyle = isActive ? "rgba(79,70,229,0.55)" : "rgba(148,163,184,0.35)";
        state.ctx.lineWidth = 1.2;
        state.ctx.stroke();
        state.ctx.fillStyle = isActive ? "#4f46e5" : "#64748b";
        state.ctx.textAlign = "left";
        state.ctx.textBaseline = "middle";
        state.ctx.fillText(label, bannerX + 12, bannerY + 14);
        state.ctx.restore();
      }
    }

    state.ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Pick-mode banner
    if (state.relLinePickMode) {
      state.ctx.fillStyle = "rgba(37, 99, 235, 0.92)";
      state.ctx.fillRect(0, 0, state.canvas.width, 38);
      state.ctx.fillStyle = "#ffffff";
      state.ctx.font = "600 13px system-ui";
      state.ctx.textAlign = "center";
      state.ctx.textBaseline = "middle";
      state.ctx.fillText("Click the target node to connect — Esc to cancel", state.canvas.width / 2, 19);
    }

    updateReorderButtons(state);
    return transitioning;
  }

  function requestDraw(state) {
    if (state.animationFrameRequested) return;
    state.animationFrameRequested = true;
    requestAnimationFrame(() => {
      const shouldContinue = drawAll(state);
      state.animationFrameRequested = false;
      if (shouldContinue) requestDraw(state);
    });
  }

  // ── persistence.js ─────────────────────────────────────────────────────────

  const AUTOSAVE_SCHEMA_VERSION = 1;
  const AUTOSAVE_STORAGE_KEY = "mindmap.autosave.v1";  // legacy key (migration only)
  const MAP_REGISTRY_KEY = "mindmap.maps.v1";           // global list of all maps
  const mapStorageKey = (id) => `mindmap.map.${id}.v1`; // per-map autosave key

  function canUseLocalStorage() {
    try {
      return typeof window !== "undefined" && !!window.localStorage;
    } catch {
      return false;
    }
  }

  // ── Map registry helpers (shared across all pages/tabs) ───────────────────

  function readRegistry() {
    try {
      if (!canUseLocalStorage()) return [];
      const raw = window.localStorage.getItem(MAP_REGISTRY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function writeRegistry(maps) {
    try {
      if (!canUseLocalStorage()) return;
      window.localStorage.setItem(MAP_REGISTRY_KEY, JSON.stringify(maps));
    } catch {}
  }

  function updateRegistryEntry(id, name) {
    const reg = readRegistry();
    const idx = reg.findIndex((m) => m.id === id);
    if (idx >= 0) { reg[idx].name = name; }
    else { reg.push({ id, name, created: Date.now() }); }
    writeRegistry(reg);
  }

  function removeFromRegistry(id) {
    writeRegistry(readRegistry().filter((m) => m.id !== id));
    try {
      if (canUseLocalStorage()) window.localStorage.removeItem(mapStorageKey(id));
    } catch {}
  }

  function mindmapToJson(state, stripAttachData = false) {
    function buildNodeTree(node) {
      return {
        id: node.id,
        text: node.text,
        customWidth: Number.isFinite(node.customWidth) ? Math.round(node.customWidth) : undefined,
        collapsed: !!node.collapsed,
        pinned: !!node.pinned,
        linkedPartId: node.linkedPartId || undefined,
        isGlobalPartSource: node.isGlobalPartSource || undefined,
        tags: (node.tags && node.tags.length > 0) ? node.tags : undefined,
        attachments: (node.attachments && node.attachments.length > 0)
          ? (stripAttachData
            ? node.attachments.map(({ id, type, name, size }) => ({ id, type, name, size }))
            : node.attachments)
          : undefined,
        note: node.note || undefined,
        noteFilePath: node.noteFilePath || undefined,
        links: (node.links && node.links.length > 0) ? node.links : undefined,
        instanceState: (node.instanceState && node.instanceState !== "live") ? node.instanceState : undefined,
        pinnedSnapshot: node.pinnedSnapshot || undefined,
        children: node.children
          .filter((c) => !c.resolvedFromPart)
          .map((child) => buildNodeTree(child))
      };
    }

    // Build multi-map format
    const mapsData = state.maps.map((map) => {
      const root = state.nodes.find((n) => n.id === map.rootId);
      return {
        id: map.id,
        name: map.name,
        nodes: root ? [buildNodeTree(root)] : []
      };
    });

    const visibleData = {
      format: "pkm-mindmap",
      version: 1,
      maps: mapsData,
      activeMapId: state.activeMapId,
      relLines: (state.relLines && state.relLines.length > 0) ? state.relLines.map((rl) => ({ ...rl })) : undefined,
      layoutMode: state.layoutMode,
      branchTheme: state.branchTheme,
      maxVisibleLevel: state.maxVisibleLevel,
      viewScale: state.viewScale,
      viewOffsetX: state.viewOffsetX,
      viewOffsetY: state.viewOffsetY
    };

    // Merge hidden branches from original data
    if (state.originalJsonData) {
      if (state.originalJsonData.maps) {
        for (let i = 0; i < visibleData.maps.length; i++) {
          const origMap = state.originalJsonData.maps.find((m) => m.id === visibleData.maps[i].id);
          if (origMap) {
            const merged = mergeHiddenBranchesById({ nodes: visibleData.maps[i].nodes }, { nodes: origMap.nodes });
            visibleData.maps[i].nodes = merged.nodes;
          }
        }
      } else if (state.originalJsonData.nodes && visibleData.maps.length === 1) {
        const merged = mergeHiddenBranchesById({ nodes: visibleData.maps[0].nodes }, state.originalJsonData);
        visibleData.maps[0].nodes = merged.nodes;
      }
    }

    function migrateLegacyNoteFields(value) {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(migrateLegacyNoteFields); return; }
      if (!value.noteFilePath && typeof value.noteTransferSource === "string" && value.noteTransferSource.trim()) {
        value.noteFilePath = value.noteTransferSource.trim();
      }
      delete value.noteTransferSource;
      for (const child of Object.values(value)) migrateLegacyNoteFields(child);
    }
    migrateLegacyNoteFields(visibleData);
    return visibleData;
  }

  // ── WMM native file format ───────────────────────────────────────────────
  // .wmm is a ZIP container with manifest.json, map.json, and optional
  // attachments/. The map itself uses the existing PKM document schema.
  const WMM_FORMAT_VERSION = 1;

  function _wmmSafeSegment(value, fallback = "file") {
    const cleaned = String(value || fallback)
      .replace(/^.*[\\/]/, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 120);
    return cleaned || fallback;
  }

  function _wmmCloneValue(value) {
    if (Array.isArray(value)) return value.map((item) => _wmmCloneValue(item));
    if (value && typeof value === "object") {
      const output = {};
      for (const [key, child] of Object.entries(value)) output[key] = _wmmCloneValue(child);
      return output;
    }
    return value;
  }

  function _wmmWalkAttachments(value, visit) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) _wmmWalkAttachments(item, visit);
      return;
    }
    if (Array.isArray(value.attachments)) {
      for (const attachment of value.attachments) {
        if (attachment && typeof attachment === "object") visit(attachment);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "attachments") continue;
      if (child && typeof child === "object") _wmmWalkAttachments(child, visit);
    }
  }

  function _wmmDecodeDataUrl(dataUrl, fallbackMime = "application/octet-stream") {
    const match = String(dataUrl || "").match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/);
    if (!match) throw new Error("Attachment data is not a valid data URL");
    const mime = match[1] || fallbackMime;
    if (match[2]) {
      const binary = atob(match[3]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { mime, bytes };
    }
    const text = decodeURIComponent(match[3]);
    return { mime, bytes: new TextEncoder().encode(text) };
  }

  function _wmmBytesToDataUrl(bytes, mime = "application/octet-stream") {
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return "data:" + (mime || "application/octet-stream") + ";base64," + btoa(binary);
  }

  function _wmmTitleFromDocument(documentData) {
    const maps = Array.isArray(documentData && documentData.maps) ? documentData.maps : [];
    const active = maps.find((map) => map.id === documentData.activeMapId) || maps[0];
    return (active && active.name && String(active.name).trim()) || "mindmap";
  }

  async function buildWmmPackage(state) {
    const JSZip = window.JSZip;
    if (!JSZip) throw new Error("JSZip not loaded — cannot create .wmm file");
    const sourceData = mindmapToJson(state, false);
    const title = _wmmTitleFromDocument(sourceData);
    // mindmapToJson intentionally reuses some attachment/snapshot objects from
    // live state. Clone the structure before replacing data URLs with ZIP paths.
    const documentData = _wmmCloneValue(sourceData);
    const zip = new JSZip();
    let attachmentIndex = 0;

    _wmmWalkAttachments(documentData, (att) => {
      if (!att.data || typeof att.data !== "string" || !att.data.startsWith("data:")) return;
      const decoded = _wmmDecodeDataUrl(att.data, att.type || "application/octet-stream");
      const id = _wmmSafeSegment(att.id || "attachment", "attachment");
      const name = _wmmSafeSegment(att.name || ("attachment_" + attachmentIndex), "attachment");
      const path = `attachments/${String(attachmentIndex++).padStart(4, "0")}_${id}_${name}`;
      zip.file(path, decoded.bytes);
      att.path = path;
      att.type = att.type || decoded.mime;
      att.size = Number.isFinite(att.size) ? att.size : decoded.bytes.byteLength;
      delete att.data;
    });

    const now = new Date().toISOString();
    zip.file("manifest.json", JSON.stringify({
      format: "wmm",
      formatVersion: WMM_FORMAT_VERSION,
      application: "PKM Mindmap",
      modified: now,
      document: "map.json"
    }, null, 2));
    zip.file("map.json", JSON.stringify(documentData, null, 2));

    const data = await zip.generateAsync({
      type: "arraybuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });
    return { data, title };
  }

  async function loadWmmFile(arrayBuffer) {
    const JSZip = window.JSZip;
    if (!JSZip) throw new Error("JSZip not loaded — cannot open .wmm file");
    let zip;
    try {
      zip = await JSZip.loadAsync(arrayBuffer);
    } catch (zipError) {
      // Compatibility fallback for early/plain-JSON WMM experiments.
      try {
        const parsed = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer)));
        const candidate = parsed && parsed.document && typeof parsed.document === "object" ? parsed.document : parsed;
        if (!candidate || (!Array.isArray(candidate.maps) && !Array.isArray(candidate.nodes))) throw zipError;
        return candidate;
      } catch {
        throw new Error("Invalid WMM file: the file is not a readable WMM ZIP container");
      }
    }

    const manifestEntry = zip.file("manifest.json");
    const manifest = manifestEntry ? JSON.parse(await manifestEntry.async("text")) : null;
    if (!manifest || manifest.format !== "wmm") throw new Error("Invalid WMM file: manifest.json is missing or has the wrong format");
    if (manifest.formatVersion !== WMM_FORMAT_VERSION) {
      throw new Error(`Unsupported WMM version: ${manifest.formatVersion}`);
    }
    const documentPath = typeof manifest.document === "string" && manifest.document ? manifest.document : "map.json";
    const mapEntry = zip.file(documentPath);
    if (!mapEntry) throw new Error(`Invalid WMM file: ${documentPath} is missing`);
    const documentData = JSON.parse(await mapEntry.async("text"));
    if (!documentData || (!Array.isArray(documentData.maps) && !Array.isArray(documentData.nodes))) {
      throw new Error("Invalid WMM file: map.json does not contain a supported mindmap document");
    }

    const inflateJobs = [];
    _wmmWalkAttachments(documentData, (att) => {
      if (!att.path || typeof att.path !== "string") return;
      const entry = zip.file(att.path);
      if (!entry) return;
      inflateJobs.push((async () => {
        const bytes = await entry.async("uint8array");
        att.data = _wmmBytesToDataUrl(bytes, att.type || "application/octet-stream");
        att.size = Number.isFinite(att.size) ? att.size : bytes.byteLength;
        delete att.path;
      })());
    });
    await Promise.all(inflateJobs);
    return documentData;
  }

  function persistDocumentAttachmentData(state) {
    for (const node of state.nodes) {
      if (!node.attachments) continue;
      for (const att of node.attachments) {
        if (att.data) _persistAttach(att.id, att.data);
      }
    }
  }

  function buildAutosaveDocument(state) {
    return {
      version: AUTOSAVE_SCHEMA_VERSION,
      savedAt: Date.now(),
      gistId: state.currentGistId || null,
      mindmap: mindmapToJson(state, true)  // strip attachment data — stored separately in IndexedDB
    };
  }

  function writeAutosave(state) {
    if (IS_OBSIDIAN) {
      postHost("dirty");
      return;
    }
    if (!canUseLocalStorage() || !state.activeMapId) return;
    try {
      const doc = buildAutosaveDocument(state);
      window.localStorage.setItem(mapStorageKey(state.activeMapId), JSON.stringify(doc));
      const map = state.maps[0];
      if (map) updateRegistryEntry(state.activeMapId, map.name);
    } catch {}
  }

  function readAutosaveDocument(mapId) {
    if (IS_OBSIDIAN) return null;
    if (!canUseLocalStorage() || !mapId) return null;
    try {
      const raw = window.localStorage.getItem(mapStorageKey(mapId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== AUTOSAVE_SCHEMA_VERSION || !parsed.mindmap) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveToHistory(state) {
    const snapshotNodes = state.nodes
      .filter((node) => !node.resolvedFromPart)
      .map((node) => ({
      id: node.id,
      text: node.text,
      numbering: node.numbering,
      x: node.x,
      y: node.y,
      height: node.height,
      width: node.width,
      customWidth: Number.isFinite(node.customWidth) ? node.customWidth : null,
      parentId: node.parent ? node.parent.id : null,
      childIds: node.children.filter((c) => !c.resolvedFromPart).map((child) => child.id),
      collapsed: !!node.collapsed,
      pinned: !!node.pinned,
      linkedPartId: node.linkedPartId || null,
      isGlobalPartSource: node.isGlobalPartSource || null,
      tags: node.tags || [],
      attachments: node.attachments || [],
      note: node.note || null,
      noteFilePath: node.noteFilePath || null,
      links: node.links || [],
      instanceState: node.instanceState || "live",
      pinnedSnapshot: node.pinnedSnapshot || null
    }));

    const snapshotRelLines = (state.relLines || []).map((rl) => ({ ...rl }));

    const snapshotLinks = state.links.map((link) => ({
      fromId: link.from.id,
      toId: link.to.id
    }));

    state.history.push({
      nodes: snapshotNodes,
      links: snapshotLinks,
      relLines: snapshotRelLines,
      selectedNodeId: state.selectedNode ? state.selectedNode.id : null,
      focusNodeId: state.focusNodeId,
      layoutMode: state.layoutMode,
      branchTheme: state.branchTheme,
      maxVisibleLevel: state.maxVisibleLevel,
      viewOffsetX: state.viewOffsetX,
      viewOffsetY: state.viewOffsetY,
      viewScale: state.viewScale,
      nextNodeId: state.nextNodeId,
      maps: state.maps.map((m) => ({ id: m.id, name: m.name, rootId: m.rootId })),
      activeMapId: state.activeMapId
    });

    if (state.history.length > state.maxHistorySteps) {
      state.history = state.history.slice(1);
    }

    updateUndoButton(state);
    setUnsavedChanges(state, true);
    writeAutosave(state);
    autoSyncGlobalParts(state);
  }

  function restoreFromHistory(state, snapshot) {
    const idToNode = new Map();
    for (const nodeSnapshot of snapshot.nodes) {
      const node = createNode(state, nodeSnapshot.text, nodeSnapshot.id);
      node.numbering = nodeSnapshot.numbering;
      node.x = nodeSnapshot.x;
      node.y = nodeSnapshot.y;
      node.height = nodeSnapshot.height;
      node.customWidth = Number.isFinite(nodeSnapshot.customWidth) ? nodeSnapshot.customWidth : null;
      node.width = node.calculateWidth();
      node.parent = null;
      node.children = [];
      node.collapsed = !!nodeSnapshot.collapsed;
      node.pinned = !!nodeSnapshot.pinned;
      node.linkedPartId = nodeSnapshot.linkedPartId || null;
      node.isGlobalPartSource = nodeSnapshot.isGlobalPartSource || null;
      node.tags = nodeSnapshot.tags || [];
      node.attachments = nodeSnapshot.attachments || [];
      node.note = nodeSnapshot.note || null;
      node.noteFilePath = nodeSnapshot.noteFilePath || null;
      node.links = nodeSnapshot.links || [];
      node.instanceState = nodeSnapshot.instanceState || "live";
      node.pinnedSnapshot = nodeSnapshot.pinnedSnapshot || null;
      idToNode.set(node.id, node);
    }
    for (const nodeSnapshot of snapshot.nodes) {
      const node = idToNode.get(nodeSnapshot.id);
      if (!node) continue;
      if (nodeSnapshot.parentId !== null) node.parent = idToNode.get(nodeSnapshot.parentId) || null;
      node.children = (nodeSnapshot.childIds || []).map((childId) => idToNode.get(childId)).filter(Boolean);
    }
    state.nodes = snapshot.nodes.map((nodeSnapshot) => idToNode.get(nodeSnapshot.id)).filter(Boolean);
    state.links = snapshot.links
      .map((linkSnapshot) => ({ from: idToNode.get(linkSnapshot.fromId), to: idToNode.get(linkSnapshot.toId) }))
      .filter((link) => link.from && link.to);
    state.selectedNode = snapshot.selectedNodeId !== null ? idToNode.get(snapshot.selectedNodeId) || null : null;
    state.focusNodeId = snapshot.focusNodeId ?? null;
    state.layoutMode = snapshot.layoutMode || "horizontal";
    state.branchTheme = snapshot.branchTheme || "Calm";
    state.maxVisibleLevel = Number.isInteger(snapshot.maxVisibleLevel) ? snapshot.maxVisibleLevel : null;
    state.viewOffsetX = snapshot.viewOffsetX;
    state.viewOffsetY = snapshot.viewOffsetY;
    state.viewScale = snapshot.viewScale;
    state.nextNodeId = Math.max(1, snapshot.nextNodeId || 1, ...state.nodes.map((node) => node.id + 1));
    state.maps = snapshot.maps || [];
    state.activeMapId = snapshot.activeMapId || (state.maps[0] && state.maps[0].id) || null;
    state.relLines = (snapshot.relLines || []).map((rl) => ({ ...rl }));
    resolveLinkedNodes(state);
    applyLevelFilter(state);
    rebuildVisibilityCaches(state);
    calculateInsertionZones(state);
    if (typeof renderMapsList === "function") renderMapsList(state);
    requestDraw(state);
  }

  function undo(state) {
    if (state.history.length <= 1) {
      showStatus(state, "Nothing to undo.");
      return;
    }
    state.history.pop();
    const previousSnapshot = state.history[state.history.length - 1];
    restoreFromHistory(state, previousSnapshot);
    updateUndoButton(state);
    updateDeleteButton(state);
    setUnsavedChanges(state, true);
    writeAutosave(state);
    postHost("dirty");
    showStatus(state, "Undid the previous action.");
  }

  function jsonToMindmap(state, jsonData) {
    state.nextNodeId = 1;
    state.nodes = [];
    state.links = [];
    state.maps = [];
    state.selectedNode = null;
    state.focusNodeId = null;

    function createNodesFromJson(nodeData, parent = null) {
      if (nodeData.hidden) return null;
      const node = createNode(state, nodeData.text, nodeData.id);
      node.parent = parent;
      node.customWidth = Number.isFinite(nodeData.customWidth)
        ? Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, nodeData.customWidth))
        : null;
      node.width = node.calculateWidth();
      node.collapsed = !!nodeData.collapsed;
      node.pinned = !!nodeData.pinned;
      node.linkedPartId = nodeData.linkedPartId || null;
      node.isGlobalPartSource = nodeData.isGlobalPartSource || null;
      node.tags = nodeData.tags || [];
      node.attachments = nodeData.attachments || [];
      node.note = nodeData.note ? sanitizeNoteHtml(nodeData.note) : null;
      node.noteFilePath = typeof nodeData.noteFilePath === "string" && nodeData.noteFilePath.trim()
        ? nodeData.noteFilePath.trim()
        : (typeof nodeData.noteTransferSource === "string" && nodeData.noteTransferSource.trim() ? nodeData.noteTransferSource.trim() : null);
      node.links = nodeData.links || [];
      node.instanceState = nodeData.instanceState || "live";
      node.pinnedSnapshot = nodeData.pinnedSnapshot || null;
      state.nodes.push(node);
      if (parent) {
        parent.children.push(node);
        state.links.push({ from: parent, to: node });
      }
      const children = Array.isArray(nodeData.children) ? nodeData.children : [];
      children.forEach((childData) => createNodesFromJson(childData, node));
      return node;
    }

    if (jsonData.maps && Array.isArray(jsonData.maps)) {
      // ── New multi-map format ──────────────────────────────────────────────
      // Normalize IDs across all maps with a shared counter
      let nextIdRef = { value: 1 };
      function normalizeNodeIds(nd) {
        if (nd.id === undefined || nd.id === null) nd.id = nextIdRef.value;
        nextIdRef.value = Math.max(nextIdRef.value, nd.id + 1);
        (nd.children || []).forEach(normalizeNodeIds);
      }
      const cloned = cloneJson(jsonData);
      for (const mapData of cloned.maps) {
        (mapData.nodes || []).forEach(normalizeNodeIds);
      }
      state.nextNodeId = nextIdRef.value;
      state.originalJsonData = cloned;

      for (const mapData of cloned.maps) {
        const rootNodeData = mapData.nodes && mapData.nodes[0];
        if (!rootNodeData) continue;
        const root = createNodesFromJson(rootNodeData, null);
        if (root) {
          state.maps.push({ id: mapData.id, name: mapData.name, rootId: root.id });
        }
      }
      state.activeMapId = jsonData.activeMapId || (state.maps[0] && state.maps[0].id) || null;
    } else {
      // ── Legacy single-map format ──────────────────────────────────────────
      const { normalized, nextId } = normalizeJsonWithStableIds(jsonData, state.nextNodeId);
      state.nextNodeId = nextId;
      state.originalJsonData = cloneJson(normalized);
      (normalized.nodes || []).forEach((nodeData) => createNodesFromJson(nodeData));
      const root = state.nodes.find((n) => !n.parent);
      if (root) {
        const mapId = "map_" + Date.now();
        state.maps.push({ id: mapId, name: root.text, rootId: root.id });
        state.activeMapId = mapId;
      }
    }

    if (jsonData.viewScale) state.viewScale = jsonData.viewScale;
    if (jsonData.layoutMode) state.layoutMode = jsonData.layoutMode;
    if (jsonData.branchTheme) state.branchTheme = jsonData.branchTheme;
    state.maxVisibleLevel = Number.isInteger(jsonData.maxVisibleLevel) && jsonData.maxVisibleLevel >= 1 ? jsonData.maxVisibleLevel : null;
    if (jsonData.viewOffsetX) state.viewOffsetX = jsonData.viewOffsetX;
    if (jsonData.viewOffsetY) state.viewOffsetY = jsonData.viewOffsetY;
    state.relLines = (jsonData.relLines || []).map((rl) => ({ ...rl }));

    autoLayout(state);
    requestDraw(state);
    setUnsavedChanges(state, false);
    saveToHistory(state);
    state.history = [state.history[0]];
    updateUndoButton(state);
    centerMindmap(state, () => requestDraw(state));
  }

  function recoverFromAutosave(state) {
    const autosaveDoc = readAutosaveDocument(state.activeMapId);
    if (!autosaveDoc) return false;
    jsonToMindmap(state, autosaveDoc.mindmap);
    state.currentGistId = autosaveDoc.gistId || null;
    if (!state.selectedNode && state.nodes.length > 0) {
      state.selectedNode = getActiveMapRoot(state) || state.nodes.find((n) => !n.parent) || state.nodes[0];
    }
    const mapName = (state.maps[0] && state.maps[0].name) || "Mindmap";
    document.title = mapName + " — Mindmap Tool";
    updateDeleteButton(state);
    setUnsavedChanges(state, true);
    // Run layout immediately so resolveLinkedNodes cleans up any stale resolved
    // children that were incorrectly persisted (e.g. from the old duplicate bug).
    autoLayout(state);
    centerMindmap(state, () => requestDraw(state));
    reinflateAttachments(state);  // sync localStorage read + async IDB sweep
    showStatus(state, "Recovered from local autosave");
    return true;
  }

  async function loadFromGist(state, gistId) {
    if (!gistId) return;
    showStatus(state, "GitHub Gist loading is unavailable in this community-plugin runtime.", 5000);
  }

  async function saveAsLocalFile(state) {
    if (state.nodes.length === 0) { showStatus(state, "Nothing to save"); return; }
    try {
      const wmm = await buildWmmPackage(state);
      const blob = new Blob([wmm.data], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = _wmmSafeSegment(wmm.title || "mindmap", "mindmap") + ".wmm";
      a.click();
      URL.revokeObjectURL(url);
      setUnsavedChanges(state, false);
      showStatus(state, `Mindmap exported as ${a.download}`);
    } catch (error) {
      showStatus(state, `Could not export WMM: ${error.message}`, 5000);
    }
  }

  // ── MindMeister import converter ─────────────────────────────────────────
  // Converts a MindMeister v3 export JSON (map_version + root) into the app's
  // native multi-map format so it can be passed directly to jsonToMindmap.
  // attachmentDataMap: Map<string id, base64-data-URL> populated when loading
  // from a .mind ZIP archive (images/ and attachments/ directories inside it).
  function importMindMeister(mmJson, attachmentDataMap = new Map()) {
    // Guess MIME type from a filename extension.
    function guessMime(name) {
      if (!name) return "application/octet-stream";
      const ext = name.split(".").pop().toLowerCase();
      const map = {
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
        gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
        pdf: "application/pdf",
        txt: "text/plain", csv: "text/csv", md: "text/markdown",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ppt: "application/vnd.ms-powerpoint",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        zip: "application/zip", rar: "application/x-rar-compressed",
        mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
        mp3: "audio/mpeg", wav: "audio/wav",
        json: "application/json", xml: "application/xml"
      };
      return map[ext] || "application/octet-stream";
    }
    // Extract MIME from a data URL (data:{mime};base64,...).
    function mimeFromDataUrl(dataUrl) {
      const m = dataUrl && dataUrl.match(/^data:([^;]+);/);
      return m ? m[1] : "application/octet-stream";
    }

    // Build metadata lookups from top-level arrays.
    // images[i].id and attachments[i].id are the file IDs that match ZIP filenames.
    const imageMetaById = new Map();
    for (const img of (mmJson.images || [])) {
      if (img.id != null) imageMetaById.set(String(img.id), {
        name: img.filename || ("image_" + img.id),
        type: img.contentType || guessMime(img.filename || "")
      });
    }
    // Top-level attachments: build a metadata lookup AND a per-node lookup.
    // MindMeister uses several different field names across export versions to
    // link an attachment to its node: idea_id, mind_map_idea_id, node_id.
    // We try all of them so no attachment is silently dropped.
    const attachMetaById = new Map();
    const attachByIdeaId = new Map();   // nodeId (string) → [{fileId, attId, name, type, apiUrl}]
    const unlinkedAtts = [];            // attachments with no node link at all
    for (const att of (mmJson.attachments || [])) {
      if (att.id == null) continue;
      const fileId = att.file_id != null ? String(att.file_id) : String(att.id);
      const attId  = String(att.id);
      const name   = att.filename || ("file_" + fileId);
      const type   = att.contentType || guessMime(name);
      const apiUrl = att.api_url || att.url || null;
      const meta   = { name, type, apiUrl };
      attachMetaById.set(attId, meta);
      if (fileId !== attId) attachMetaById.set(fileId, meta);

      // Try every field name MindMeister has used across versions.
      const nodeId = att.idea_id ?? att.mind_map_idea_id ?? att.node_id ?? att.parent_id ?? null;
      if (nodeId != null) {
        const key = String(nodeId);
        if (!attachByIdeaId.has(key)) attachByIdeaId.set(key, []);
        attachByIdeaId.get(key).push({ fileId, attId, name, type, apiUrl });
      } else {
        // No node link found — collect for fallback onto the root node.
        unlinkedAtts.push({ fileId, attId, name, type, apiUrl });
      }
    }

    // Top-level links array: each entry links a URL (or external reference) to a node.
    // Fields: idea_id / mind_map_idea_id / node_id link to the node; url is the href.
    const linksByIdeaId = new Map(); // nodeId → [{label, url}]
    for (const lnk of (mmJson.links || [])) {
      const nodeId = lnk.idea_id ?? lnk.mind_map_idea_id ?? lnk.node_id ?? null;
      if (nodeId == null) continue;
      const key = String(nodeId);
      if (!linksByIdeaId.has(key)) linksByIdeaId.set(key, []);
      linksByIdeaId.get(key).push({
        label: lnk.title || lnk.label || lnk.url || "Link",
        url:   lnk.url || lnk.href || null
      });
    }

    // Try every plausible ZIP key for a given attachment and return the first hit.
    // MindMeister may name ZIP entries by file_id, record id, or original filename.
    function resolveZipData(fileId, attId, filename) {
      const keysToTry = [];
      if (fileId) keysToTry.push(String(fileId));
      if (attId && String(attId) !== String(fileId)) keysToTry.push(String(attId));
      if (filename) {
        keysToTry.push(filename);                          // "paper.pdf"
        const bare = filename.replace(/\.[^.]+$/, "");
        if (bare !== filename) keysToTry.push(bare);       // "paper"
      }
      for (const key of keysToTry) {
        const d = attachmentDataMap.get(key);
        if (d) return d;
      }
      return null;
    }

    let nextId = 1;
    // MindMeister relationship records refer to the original topic/idea IDs.
    // Keep those IDs while converting the tree to the PKM numeric node IDs.
    // A title lookup is also kept as a defensive fallback for older exports that
    // store a topic title instead of an ID in a connector endpoint.
    const mindMeisterIdToAppId = new Map();
    const mindMeisterTitleToAppIds = new Map();
    // extraRootAtts: unlinked top-level attachments that get placed on the root node.
    // Populated after all nodes are converted (root id is known at that point).
    let rootNodeRef = null;
    function convertNode(mmNode) {
      const id = nextId++;
      if (mmNode && mmNode.id != null) {
        mindMeisterIdToAppId.set(String(mmNode.id), id);
      }
      const originalTitle = String((mmNode && (mmNode.title ?? mmNode.text ?? mmNode.name)) || "Untitled").trim() || "Untitled";
      if (!mindMeisterTitleToAppIds.has(originalTitle)) mindMeisterTitleToAppIds.set(originalTitle, []);
      mindMeisterTitleToAppIds.get(originalTitle).push(id);
      const children = (mmNode.children || [])
        .slice()
        .sort((a, b) => ((a.rank || 0) - (b.rank || 0)))
        .map(convertNode);

      const appAttachments = [];

      // ── Node image ───────────────────────────────────────────────────────
      if (mmNode.image) {
        const fileId = mmNode.image.image_file_id != null
          ? String(mmNode.image.image_file_id)
          : (mmNode.image.id != null ? String(mmNode.image.id) : null);
        const attId = mmNode.image.id != null ? String(mmNode.image.id) : null;
        const filename = mmNode.image.filename || mmNode.image.name || null;
        if (fileId || attId) {
          const dataUrl = resolveZipData(fileId, attId, filename);
          const meta = imageMetaById.get(fileId) || imageMetaById.get(attId) || null;
          const name = (meta && meta.name) || filename || ("image_" + (fileId || attId));
          const type = dataUrl ? mimeFromDataUrl(dataUrl) : ((meta && meta.type) || guessMime(name));
          const entry = { id: "mm_img_" + (fileId || attId), name, type };
          if (dataUrl) {
            entry.data = dataUrl;
            entry.size = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4);
          }
          appAttachments.push(entry);
        }
      }

      // ── Note (rich text) ────────────────────────────────────────────────
      // MindMeister stores notes as HTML in node.note or node.notes.
      const rawNote = mmNode.note || mmNode.notes || null;
      const noteHtml = rawNote ? (typeof rawNote === "string" ? rawNote : (rawNote.html || rawNote.text || String(rawNote))) : null;

      // ── URL link attached to this node ───────────────────────────────
      // node.link is a single URL string; linksByIdeaId holds top-level link records.
      const nodeLinks = [];
      if (mmNode.link) {
        const href = typeof mmNode.link === "string" ? mmNode.link : (mmNode.link.url || mmNode.link.href || null);
        const label = (typeof mmNode.link === "object" && (mmNode.link.title || mmNode.link.label)) || href;
        if (href) nodeLinks.push({ label: label || href, url: href });
      }
      for (const lnk of (linksByIdeaId.get(String(mmNode.id)) || [])) {
        if (lnk.url && !nodeLinks.some((l) => l.url === lnk.url)) nodeLinks.push(lnk);
      }

      // ── File attachments ─────────────────────────────────────────────────
      // Build a merged, deduplicated list from BOTH the node's own `attachments`
      // array AND the top-level `attachments` array (keyed by idea_id). MindMeister
      // may put the full metadata in one source and partial info in the other.
      // We use a Map keyed by a stable id so each attachment appears only once.
      const attSourceMap = new Map(); // stableKey → {fileId, attId, filename, type, apiUrl, meta}

      // 1. Node-level attachments (may lack file_id or contentType)
      for (const att of (mmNode.attachments || [])) {
        const attId  = att.id != null ? String(att.id) : null;
        const fileId = att.file_id != null ? String(att.file_id) : attId;
        const key = fileId || attId;
        if (!key) continue;
        const topMeta = attachMetaById.get(fileId) || attachMetaById.get(attId) || null;
        attSourceMap.set(key, {
          fileId, attId,
          name:   (topMeta && topMeta.name)   || att.filename || att.name || ("file_" + key),
          type:   (topMeta && topMeta.type)   || att.contentType || guessMime(att.filename || att.name || ""),
          apiUrl: (topMeta && topMeta.apiUrl) || att.api_url || att.url || null
        });
      }

      // 2. Top-level attachments linked to this node via idea_id / mind_map_idea_id etc.
      for (const rec of (attachByIdeaId.get(String(mmNode.id)) || [])) {
        const key = rec.fileId || rec.attId;
        if (!key) continue;
        if (attSourceMap.has(key)) {
          const ex = attSourceMap.get(key);
          if (!ex.apiUrl && rec.apiUrl) ex.apiUrl = rec.apiUrl;
        } else {
          attSourceMap.set(key, rec);
        }
      }

      for (const { fileId, attId, name, type, apiUrl } of attSourceMap.values()) {
        const dataUrl = resolveZipData(fileId, attId, name);
        const stableId = "mm_att_" + (fileId || attId);
        if (appAttachments.some((a) => a.id === stableId)) continue;
        const entry = { id: stableId, name, type };
        if (dataUrl) {
          entry.data = dataUrl;
          entry.size = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4);
        } else if (apiUrl) {
          // No embedded data — store the CDN URL so the badge can open it in a new tab.
          entry.url = apiUrl;
        }
        appAttachments.push(entry);
      }

      const node = { id, text: originalTitle, children };
      if (appAttachments.length > 0) node.attachments = appAttachments;
      if (noteHtml) node.note = noteHtml;
      if (nodeLinks.length > 0) node.links = nodeLinks;
      if (!rootNodeRef) rootNodeRef = node; // first node converted is always the root
      return node;
    }
    const root = convertNode(mmJson.root);

    // Attach unlinked top-level attachments to the root node so they are visible
    // even when MindMeister omitted idea_id from the export.
    if (unlinkedAtts.length > 0) {
      if (!root.attachments) root.attachments = [];
      for (const { fileId, attId, name, type, apiUrl } of unlinkedAtts) {
        const stableId = "mm_att_" + (fileId || attId);
        if (root.attachments.some((a) => a.id === stableId)) continue;
        const dataUrl = resolveZipData(fileId, attId, name);
        const entry = { id: stableId, name, type };
        if (dataUrl) {
          entry.data = dataUrl;
          entry.size = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4);
        } else if (apiUrl) {
          entry.url = apiUrl;
        }
        root.attachments.push(entry);
      }
    }
    // ── MindMeister relationship / connection import ────────────────────────
    // MindMeister stores non-hierarchical topic connections separately from the
    // child tree. Different generations of .mind exports have used slightly
    // different container and endpoint field names, so normalize all common
    // variants into the plugin's native relLines model.
    function relationValues(value) {
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") return Object.values(value);
      return [];
    }

    function collectMindMeisterRelations() {
      const records = [];
      const push = (value) => {
        for (const item of relationValues(value)) {
          if (item && typeof item === "object") records.push(item);
        }
      };
      // Top-level variants seen in exported/legacy MindMeister documents.
      push(mmJson.connections);
      push(mmJson.relationships);
      push(mmJson.connectors);
      if (mmJson.map && typeof mmJson.map === "object") {
        push(mmJson.map.connections);
        push(mmJson.map.relationships);
        push(mmJson.map.connectors);
      }
      if (mmJson.data && typeof mmJson.data === "object") {
        push(mmJson.data.connections);
        push(mmJson.data.relationships);
        push(mmJson.data.connectors);
      }
      // Some exports attach connection records to the source idea instead.
      function walkIdea(idea) {
        if (!idea || typeof idea !== "object") return;
        push(idea.connections);
        push(idea.relationships);
        push(idea.connectors);
        for (const child of (Array.isArray(idea.children) ? idea.children : [])) walkIdea(child);
      }
      walkIdea(mmJson.root);
      return records;
    }

    function endpointScalar(value) {
      if (value == null) return null;
      if (typeof value === "object") {
        value = value.id ?? value.idea_id ?? value.ideaId ?? value.topic_id ?? value.topicId ??
          value.node_id ?? value.nodeId ?? value.key ?? value.value ?? value.title ?? value.text ?? value.name ?? null;
      }
      if (value == null) return null;
      return String(value).trim() || null;
    }

    function endpointCandidates(connection, side) {
      const isFrom = side === "from";
      const keys = isFrom
        ? ["from", "source", "source_id", "sourceId", "from_id", "fromId", "source_idea_id", "sourceIdeaId", "source_topic_id", "sourceTopicId", "origin", "origin_id", "originId", "start", "start_id", "startId"]
        : ["to", "target", "target_id", "targetId", "to_id", "toId", "target_idea_id", "targetIdeaId", "target_topic_id", "targetTopicId", "destination", "destination_id", "destinationId", "end", "end_id", "endId"];
      const values = [];
      for (const key of keys) {
        if (connection[key] != null) values.push(connection[key]);
      }
      // Array-style endpoint fields used by a few serializers.
      const arrays = [connection.idea_ids, connection.ideaIds, connection.topic_ids, connection.topicIds, connection.node_ids, connection.nodeIds, connection.nodes, connection.endpoints];
      for (const arr of arrays) {
        if (!Array.isArray(arr) || arr.length < 2) continue;
        values.push(isFrom ? arr[0] : arr[1]);
      }
      return values;
    }

    function resolveMindMeisterEndpoint(connection, side) {
      for (const raw of endpointCandidates(connection, side)) {
        const scalar = endpointScalar(raw);
        if (!scalar) continue;
        if (mindMeisterIdToAppId.has(scalar)) return mindMeisterIdToAppId.get(scalar);
        // Some serializers prefix topic IDs (e.g. "idea_123"). Strip a
        // conservative set of prefixes before giving up on ID matching.
        const stripped = scalar.replace(/^(?:idea|topic|node|id)[_:\-\s]+/i, "");
        if (stripped !== scalar && mindMeisterIdToAppId.has(stripped)) return mindMeisterIdToAppId.get(stripped);
        // Last-resort title match only when the title is unique in the map.
        const titleMatches = mindMeisterTitleToAppIds.get(scalar);
        if (titleMatches && titleMatches.length === 1) return titleMatches[0];
      }
      return null;
    }

    function relationText(value) {
      if (value == null) return "";
      if (typeof value === "string" || typeof value === "number") return String(value).trim();
      if (typeof value === "object") {
        return String(value.text ?? value.title ?? value.label ?? value.name ?? value.value ?? "").trim();
      }
      return "";
    }

    function relationColor(value) {
      if (value && typeof value === "object") {
        if (Number.isFinite(value.r) && Number.isFinite(value.g) && Number.isFinite(value.b)) {
          const r = Math.max(0, Math.min(255, Math.round(value.r)));
          const g = Math.max(0, Math.min(255, Math.round(value.g)));
          const b = Math.max(0, Math.min(255, Math.round(value.b)));
          return `rgb(${r}, ${g}, ${b})`;
        }
        value = value.color ?? value.stroke ?? value.strokeColor ?? value.lineColor ?? value.value ?? null;
      }
      if (value == null) return null;
      let color = String(value).trim();
      if (!color) return null;
      if (/^[0-9a-f]{3}$/i.test(color) || /^[0-9a-f]{6}$/i.test(color)) color = "#" + color;
      if (/^#[0-9a-f]{8}$/i.test(color)) color = color.slice(0, 7);
      if (/^#[0-9a-f]{3}$/i.test(color) || /^#[0-9a-f]{6}$/i.test(color)) return color;
      if (/^(?:rgb|rgba|hsl|hsla)\(/i.test(color)) return color;
      // CSS named colors are safe to pass through; browser canvas validates them.
      if (/^[a-z]+$/i.test(color)) return color;
      return null;
    }

    function markerHasArrow(value) {
      const marker = relationText(value).toLowerCase();
      if (!marker || marker === "none" || marker === "0" || marker === "false") return false;
      return /arrow|triangle|chevron|pointer|end|filled/.test(marker);
    }

    function relationDirection(connection, style) {
      const raw = relationText(connection.direction ?? connection.dir ?? connection.arrow_direction ?? connection.arrowDirection ?? style.direction ?? style.dir).toLowerCase();
      if (/both|bidirect|two.?way|double/.test(raw)) return "both";
      if (/back|reverse|left|start/.test(raw)) return "backward";
      if (/forward|right|end/.test(raw)) return "forward";
      const startMarker = connection.line_start ?? connection.lineStart ?? connection.start_icon ?? connection.startIcon ?? connection.marker_start ?? connection.markerStart ??
        style.line_start ?? style.lineStart ?? style.start_icon ?? style.startIcon ?? style.marker_start ?? style.markerStart ?? style.start;
      const endMarker = connection.line_end ?? connection.lineEnd ?? connection.end_icon ?? connection.endIcon ?? connection.marker_end ?? connection.markerEnd ??
        style.line_end ?? style.lineEnd ?? style.end_icon ?? style.endIcon ?? style.marker_end ?? style.markerEnd ?? style.end;
      const startArrow = markerHasArrow(startMarker);
      const endArrow = markerHasArrow(endMarker);
      if (startArrow && endArrow) return "both";
      if (startArrow && !endArrow) return "backward";
      return "forward";
    }

    const relLines = [];
    const seenRelations = new Set();
    const rawRelations = collectMindMeisterRelations();
    for (let index = 0; index < rawRelations.length; index++) {
      const connection = rawRelations[index];
      const fromId = resolveMindMeisterEndpoint(connection, "from");
      const toId = resolveMindMeisterEndpoint(connection, "to");
      if (!Number.isInteger(fromId) || !Number.isInteger(toId) || fromId === toId) continue;

      const identity = String(connection.id ?? connection.connection_id ?? connection.connectionId ?? connection.relationship_id ?? connection.relationshipId ?? index);
      const dedupeKey = `${fromId}->${toId}:${identity}`;
      if (seenRelations.has(dedupeKey)) continue;
      seenRelations.add(dedupeKey);

      const style = (connection.style && typeof connection.style === "object") ? connection.style :
        ((connection.connection_style && typeof connection.connection_style === "object") ? connection.connection_style :
          ((connection.format && typeof connection.format === "object") ? connection.format : {}));
      const label = relationText(connection.label ?? connection.title ?? connection.text ?? connection.caption ?? connection.name ?? connection.description);
      const color = relationColor(
        connection.color ?? connection.line_color ?? connection.lineColor ?? connection.stroke ?? connection.strokeColor ??
        style.color ?? style.line_color ?? style.lineColor ?? style.stroke ?? style.strokeColor
      ) || "#16a34a";

      relLines.push({
        id: `mm_rel_${identity}`,
        fromId,
        toId,
        label,
        color,
        direction: relationDirection(connection, style),
        labelOffsetX: 0,
        labelOffsetY: 0,
        cpOffsetX: 0,
        cpOffsetY: 0,
        importedFrom: "MindMeister"
      });
    }

    const mapId = "map_" + Date.now();
    return {
      maps: [{ id: mapId, name: root.text, nodes: [root] }],
      activeMapId: mapId,
      relLines: relLines.length > 0 ? relLines : undefined,
      layoutMode: "horizontal",
      branchTheme: "Calm",
      viewScale: 1,
      viewOffsetX: 0,
      viewOffsetY: 0
    };
  }

  // ── MindMeister .mind ZIP loader ─────────────────────────────────────────
  // A .mind file is a ZIP containing map.json plus attachments/ and images/
  // directories (files named by their numeric ID, with the original filename
  // given by the id→name mapping inside map.json).
  async function loadMindFile(zipArrayBuffer) {
    const JSZip = window.JSZip;
    if (!JSZip) throw new Error("JSZip not loaded — cannot open .mind file");

    const zip = await JSZip.loadAsync(zipArrayBuffer);

    // Find map.json (may be at root or one level deep inside a folder)
    let mapEntry = zip.file("map.json");
    if (!mapEntry) {
      const found = zip.file(/\/map\.json$/)[0] || zip.file(/^map\.json$/)[0];
      mapEntry = found || null;
    }
    if (!mapEntry) throw new Error("No map.json found inside .mind archive");

    const mapText = await mapEntry.async("text");
    const mmJson = JSON.parse(mapText);

    // Build a lookup of all non-JSON files by their bare filename (the numeric ID).
    // MindMeister stores files as  attachments/{id}  or  images/{id}  or  {id}.{ext}
    // We index every file under both its bare name (sans extension) and full name.
    const attachmentDataMap = new Map(); // id string → data URL

    const filePromises = [];
    zip.forEach((relativePath, zipEntry) => {
      if (zipEntry.dir) return;
      if (/map\.json$/i.test(relativePath)) return;

      filePromises.push((async () => {
        const bare = relativePath.replace(/^.*\//, "").replace(/\.[^.]+$/, ""); // strip dir + ext
        const fullName = relativePath.replace(/^.*\//, "");                      // strip dir only

        const uint8 = await zipEntry.async("uint8array");

        // Determine MIME type: prefer magic-byte sniffing so files without extensions work.
        function sniffMime(bytes, filename) {
          if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
          if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png";
          if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
          // WebP: RIFF????WEBP
          if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
              bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
          if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
          // OLE2 Compound Document (legacy .xls, .doc, .ppt)
          if (bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) {
            const ext = filename.split(".").pop().toLowerCase();
            if (ext === "xls") return "application/vnd.ms-excel";
            if (ext === "ppt") return "application/vnd.ms-powerpoint";
            return "application/msword"; // .doc or unknown OLE2
          }
          // ZIP-based Office formats (XLSX, DOCX, PPTX all start with PK)
          // — fall through to extension lookup so the correct subtype is used.
          // Fall back to extension-based guess
          const ext = filename.split(".").pop().toLowerCase();
          const mimeMap = {
            jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
            gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
            pdf: "application/pdf",
            txt: "text/plain", csv: "text/csv", md: "text/markdown",
            doc: "application/msword",
            docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            xls: "application/vnd.ms-excel",
            xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ppt: "application/vnd.ms-powerpoint",
            pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            zip: "application/zip", rar: "application/x-rar-compressed",
            mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
            mp3: "audio/mpeg", wav: "audio/wav",
            json: "application/json", xml: "application/xml"
          };
          return mimeMap[ext] || "application/octet-stream";
        }
        const mime = sniffMime(uint8, fullName);
        // Convert Uint8Array → base64 safely (avoids call-stack overflow for large files)
        let binary = "";
        const chunkSize = 8192;
        for (let i = 0; i < uint8.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunkSize));
        }
        const dataUrl = "data:" + mime + ";base64," + btoa(binary);
        attachmentDataMap.set(bare, dataUrl);
        if (fullName !== bare) attachmentDataMap.set(fullName, dataUrl);
      })());
    });

    await Promise.all(filePromises);


    return { mmJson, attachmentDataMap };
  }


  // ── Common mind-map import adapters ──────────────────────────────────────
  // Imported formats are normalized into the PKM document schema first. In
  // Obsidian the host immediately packages that normalized document as .wmm.

  function _importFileStem(filename) {
    return String(filename || "mindmap").replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").trim() || "mindmap";
  }

  function _importText(arrayBuffer) {
    return new TextDecoder("utf-8").decode(new Uint8Array(arrayBuffer)).replace(/^\uFEFF/, "");
  }

  function _importMakeDocument(mapSpecs, fallbackTitle = "Mindmap") {
    let nextId = 1;
    const maps = [];
    function normalizeNode(node, fallback = "Topic") {
      const text = String((node && node.text) || fallback || "Topic").trim() || "Topic";
      const out = {
        id: nextId++,
        text,
        children: []
      };
      if (node && node.note) out.note = sanitizeNoteHtml(node.note);
      if (node && Array.isArray(node.tags) && node.tags.length) out.tags = node.tags.map(String);
      if (node && Array.isArray(node.links) && node.links.length) out.links = cloneJson(node.links);
      // Preserve imported attachments (including XMind embedded images) when
      // normalizing external formats into the PKM document schema.
      if (node && Array.isArray(node.attachments) && node.attachments.length) out.attachments = cloneJson(node.attachments);
      for (const child of ((node && node.children) || [])) out.children.push(normalizeNode(child));
      return out;
    }
    for (let i = 0; i < mapSpecs.length; i++) {
      const spec = mapSpecs[i] || {};
      if (!spec.root) continue;
      const root = normalizeNode(spec.root, spec.name || fallbackTitle);
      maps.push({
        id: `map_import_${Date.now()}_${i}`,
        name: String(spec.name || root.text || fallbackTitle).trim() || fallbackTitle,
        nodes: [root]
      });
    }
    if (!maps.length) throw new Error("No mind-map topics were found in the imported file");
    return {
      format: "pkm-mindmap",
      version: 1,
      maps,
      activeMapId: maps[0].id,
      layoutMode: "horizontal",
      branchTheme: "Calm",
      viewScale: 1,
      viewOffsetX: 0,
      viewOffsetY: 0
    };
  }

  function _xmindNormalizeResourceRef(value) {
    let ref = String(value || "").trim();
    if (!ref) return "";
    ref = ref.replace(/^xap:/i, "");
    ref = ref.replace(/^file:\/\//i, "");
    ref = ref.replace(/^\.\//, "");
    ref = ref.replace(/^\/+/, "");
    try { ref = decodeURIComponent(ref); } catch {}
    return ref.replace(/\\/g, "/");
  }

  function _xmindResourceBasename(value) {
    const normalized = _xmindNormalizeResourceRef(value);
    return normalized.split("/").filter(Boolean).pop() || "resource";
  }

  function _xmindMimeFromNameAndBytes(name, bytes) {
    const ext = String(name || "").split(".").pop().toLowerCase();
    const byExt = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
      webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif",
      pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv"
    };
    if (byExt[ext]) return byExt[ext];
    if (bytes && bytes.length >= 12) {
      if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png";
      if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
      if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
      if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
          bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
      const head = new TextDecoder("utf-8").decode(bytes.subarray(0, Math.min(bytes.length, 512))).trimStart();
      if (/^<svg[\s>]/i.test(head) || /<svg[\s>]/i.test(head)) return "image/svg+xml";
    }
    return "application/octet-stream";
  }

  async function _xmindBuildResourceMap(zip) {
    const resourceMap = new Map();
    if (!zip) return resourceMap;
    const entries = Object.values(zip.files || {}).filter((entry) => {
      if (!entry || entry.dir) return false;
      const normalized = String(entry.name || "").replace(/\\/g, "/");
      return /^(resources|attachments)\//i.test(normalized);
    });

    await Promise.all(entries.map(async (entry) => {
      try {
        const bytes = await entry.async("uint8array");
        const normalized = _xmindNormalizeResourceRef(entry.name);
        const base = _xmindResourceBasename(normalized);
        const mime = _xmindMimeFromNameAndBytes(normalized, bytes);
        const data = _wmmBytesToDataUrl(bytes, mime);
        const record = { path: normalized, name: base, type: mime, size: bytes.byteLength, data };
        const keys = new Set([
          normalized,
          normalized.toLowerCase(),
          base,
          base.toLowerCase(),
          "xap:" + normalized,
          "xap:" + normalized.toLowerCase()
        ]);
        for (const key of keys) resourceMap.set(key, record);
      } catch {}
    }));
    return resourceMap;
  }

  function _xmindResolveResource(resourceMap, ref) {
    if (!resourceMap || !ref) return null;
    const normalized = _xmindNormalizeResourceRef(ref);
    const base = _xmindResourceBasename(normalized);
    const candidates = [
      String(ref), String(ref).toLowerCase(), normalized, normalized.toLowerCase(),
      base, base.toLowerCase(), "xap:" + normalized, "xap:" + normalized.toLowerCase()
    ];
    for (const key of candidates) {
      if (resourceMap.has(key)) return resourceMap.get(key);
    }
    return null;
  }

  function _xmindTopicImageAttachment(topic, resourceMap) {
    const image = topic && topic.image;
    if (!image) return null;
    const src = typeof image === "string" ? image : (image.src || image.href || image.url || image.path);
    if (!src) return null;

    // Some producers can embed a data URL directly rather than using resources/.
    if (/^data:image\//i.test(src)) {
      const mimeMatch = String(src).match(/^data:([^;,]+)/i);
      return {
        id: `xmind-image-${(topic && topic.id) || Math.random().toString(36).slice(2)}`,
        type: mimeMatch ? mimeMatch[1] : "image/png",
        name: _xmindResourceBasename(image.name || image.filename || "image.png"),
        size: 0,
        data: src
      };
    }

    const record = _xmindResolveResource(resourceMap, src);
    if (!record) return null;
    return {
      id: `xmind-image-${(topic && topic.id) || "topic"}-${record.name}`,
      type: record.type && record.type.startsWith("image/") ? record.type : _xmindMimeFromNameAndBytes(record.name),
      name: record.name,
      size: record.size,
      data: record.data
    };
  }

  function _xmindNote(topic) {
    const notes = topic && topic.notes;
    const html = notes && notes.html && (notes.html.content || notes.html.text);
    if (html) return sanitizeNoteHtml(html);
    const plain = notes && notes.plain && (notes.plain.content || notes.plain.text);
    return plain ? `<p>${escapeHtml(plain).replace(/\n/g, "<br>")}</p>` : null;
  }

  function _xmindTopicToImportNode(topic, resourceMap) {
    const childGroups = topic && topic.children ? topic.children : {};
    const children = [];
    for (const key of ["attached", "detached", "topics"]) {
      if (Array.isArray(childGroups[key])) children.push(...childGroups[key]);
    }
    // Some XMind-derived JSON converters use a flat `topics` array instead of
    // content.json's children.attached structure.
    if (children.length === 0 && Array.isArray(topic && topic.topics)) children.push(...topic.topics);

    const links = [];
    const href = topic && (topic.href || topic.hyperlink || topic.link);
    if (typeof href === "string" && href.trim() && !/^xap:/i.test(href.trim())) {
      links.push({ label: href, url: href });
    }
    const labels = Array.isArray(topic && topic.labels) ? topic.labels : [];
    const attachments = [];
    const imageAttachment = _xmindTopicImageAttachment(topic, resourceMap);
    if (imageAttachment) attachments.push(imageAttachment);

    const result = {
      text: (topic && (topic.title || topic.text || topic.name)) || "Topic",
      note: _xmindNote(topic),
      tags: labels,
      links,
      children: children.map((child) => _xmindTopicToImportNode(child, resourceMap))
    };
    if (attachments.length) result.attachments = attachments;
    return result;
  }

  function importXMindJson(json, fallbackTitle, resourceMap = new Map()) {
    const sheets = Array.isArray(json) ? json : (Array.isArray(json && json.sheets) ? json.sheets : []);
    const specs = [];
    for (const sheet of sheets) {
      const rootTopic = sheet && (sheet.rootTopic || sheet.root || sheet.topic);
      if (!rootTopic) continue;
      const root = _xmindTopicToImportNode(rootTopic, resourceMap);
      specs.push({ name: sheet.title || root.text || fallbackTitle, root });
    }
    if (!specs.length && json && json.rootTopic) {
      const root = _xmindTopicToImportNode(json.rootTopic, resourceMap);
      specs.push({ name: json.title || root.text || fallbackTitle, root });
    }
    if (!specs.length) throw new Error("XMind content did not contain a root topic");
    return _importMakeDocument(specs, fallbackTitle);
  }

  function _mindMupIdeaToNode(idea) {
    const ideas = idea && idea.ideas && typeof idea.ideas === "object" ? idea.ideas : {};
    const ordered = Object.entries(ideas).sort((a, b) => Number(a[0]) - Number(b[0]));
    const noteText = idea && (idea.note || (idea.attr && idea.attr.note));
    return {
      text: (idea && (idea.title || idea.text || idea.name)) || "Topic",
      note: noteText ? `<p>${escapeHtml(String(noteText)).replace(/\n/g, "<br>")}</p>` : null,
      children: ordered.map(([, child]) => _mindMupIdeaToNode(child))
    };
  }

  function importMindMupJson(json, fallbackTitle) {
    const root = _mindMupIdeaToNode(json);
    return _importMakeDocument([{ name: json.title || root.text || fallbackTitle, root }], fallbackTitle);
  }

  function _genericJsonNode(value) {
    if (!value || typeof value !== "object") return null;
    const text = value.title ?? value.text ?? value.name ?? value.label ?? value.topic ?? value.caption;
    const childSource = value.children ?? value.topics ?? value.nodes ?? value.subtopics ?? value.ideas;
    let childValues = [];
    if (Array.isArray(childSource)) childValues = childSource;
    else if (childSource && typeof childSource === "object") childValues = Object.values(childSource);
    const children = childValues.map(_genericJsonNode).filter(Boolean);
    if (text == null && children.length === 0) return null;
    return { text: text == null ? "Topic" : String(text), children };
  }

  function importJsonMindmap(json, fallbackTitle = "Mindmap") {
    if (json && typeof json === "object" && (Array.isArray(json.maps) || Array.isArray(json.nodes))) {
      return { document: json, formatLabel: "PKM JSON" };
    }
    if (json && typeof json === "object" && json.map_version && json.root && json.root.title !== undefined) {
      return { document: importMindMeister(json), formatLabel: "MindMeister JSON" };
    }
    const xmindSheets = Array.isArray(json)
      ? json.some((item) => item && (item.rootTopic || item.class === "sheet"))
      : !!(json && (json.rootTopic || Array.isArray(json.sheets)));
    if (xmindSheets) return { document: importXMindJson(json, fallbackTitle), formatLabel: "XMind" };
    if (json && typeof json === "object" && json.ideas && (json.title || json.id)) {
      return { document: importMindMupJson(json, fallbackTitle), formatLabel: "MindMup" };
    }
    const rootCandidate = json && typeof json === "object" ? (json.root || json.topic || json.node || json) : null;
    const genericRoot = _genericJsonNode(rootCandidate);
    if (genericRoot) {
      return { document: _importMakeDocument([{ name: fallbackTitle || genericRoot.text, root: genericRoot }], fallbackTitle), formatLabel: "JSON outline" };
    }
    throw new Error("The JSON file does not contain a recognized mind-map structure");
  }

  function _xmlLocalName(element) {
    return String((element && (element.localName || element.nodeName)) || "").replace(/^.*:/, "").toLowerCase();
  }

  function _xmlElementChildren(element) {
    return Array.from((element && element.children) || []);
  }

  function _xmlTopicText(element) {
    if (!element) return "Topic";
    for (const name of ["TEXT", "text", "TITLE", "title", "NAME", "name", "PlainText", "plainText"]) {
      const value = element.getAttribute && element.getAttribute(name);
      if (value && value.trim()) return value.trim();
    }
    for (const child of _xmlElementChildren(element)) {
      const local = _xmlLocalName(child);
      if (local === "title") {
        const value = child.textContent && child.textContent.trim();
        if (value) return value;
      }
      if (local === "text") {
        const attr = child.getAttribute && (child.getAttribute("PlainText") || child.getAttribute("plainText"));
        if (attr && attr.trim()) return attr.trim();
        const value = child.textContent && child.textContent.trim();
        if (value) return value;
      }
    }
    return "Topic";
  }

  function _xmlNearestTopicChildren(element, acceptedNames) {
    const found = [];
    function walk(parent) {
      for (const child of _xmlElementChildren(parent)) {
        const local = _xmlLocalName(child);
        if (acceptedNames.has(local)) found.push(child);
        else walk(child);
      }
    }
    walk(element);
    return found;
  }

  function _xmlTopicToNode(element, acceptedNames) {
    const children = _xmlNearestTopicChildren(element, acceptedNames);
    let note = null;
    for (const child of _xmlElementChildren(element)) {
      const local = _xmlLocalName(child);
      const type = child.getAttribute && child.getAttribute("TYPE");
      if ((local === "richcontent" && String(type || "").toUpperCase() === "NOTE") || local === "notes" || local === "note") {
        const value = child.textContent && child.textContent.trim();
        if (value) note = `<p>${escapeHtml(value).replace(/\n/g, "<br>")}</p>`;
      }
    }
    return {
      text: _xmlTopicText(element),
      note,
      children: children.map((child) => _xmlTopicToNode(child, acceptedNames))
    };
  }

  function _xmindXmlImageRefsForTopic(topicElement) {
    const refs = [];
    function walk(element) {
      for (const child of _xmlElementChildren(element)) {
        const local = _xmlLocalName(child);
        if (local === "topic") continue; // do not steal images from child topics
        if (local === "img" || local === "image") {
          const src = (child.getAttribute && (
            child.getAttribute("xhtml:src") || child.getAttribute("src") ||
            child.getAttribute("xlink:href") || child.getAttribute("href")
          )) || "";
          if (src) refs.push(src);
        }
        walk(child);
      }
    }
    walk(topicElement);
    return refs;
  }

  function _xmindXmlTopicToNode(element, resourceMap) {
    const children = _xmlNearestTopicChildren(element, new Set(["topic"]));
    let note = null;
    for (const child of _xmlElementChildren(element)) {
      const local = _xmlLocalName(child);
      const type = child.getAttribute && child.getAttribute("TYPE");
      if ((local === "richcontent" && String(type || "").toUpperCase() === "NOTE") || local === "notes" || local === "note") {
        const value = child.textContent && child.textContent.trim();
        if (value) note = `<p>${escapeHtml(value).replace(/\n/g, "<br>")}</p>`;
      }
    }
    const attachments = [];
    for (const ref of _xmindXmlImageRefsForTopic(element)) {
      const record = _xmindResolveResource(resourceMap, ref);
      if (!record || !(record.type || "").startsWith("image/")) continue;
      attachments.push({
        id: `xmind-image-${(element.getAttribute && element.getAttribute("id")) || "topic"}-${record.name}`,
        type: record.type,
        name: record.name,
        size: record.size,
        data: record.data
      });
    }
    const result = {
      text: _xmlTopicText(element),
      note,
      children: children.map((child) => _xmindXmlTopicToNode(child, resourceMap))
    };
    if (attachments.length) result.attachments = attachments;
    return result;
  }

  function importXMindXml(xmlText, fallbackTitle = "Mindmap", resourceMap = new Map()) {
    const doc = new DOMParser().parseFromString(String(xmlText || ""), "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("The XMind XML file could not be parsed");
    const sheets = Array.from(doc.getElementsByTagNameNS("*", "sheet"));
    const specs = [];
    for (const sheet of sheets) {
      const topic = _xmlNearestTopicChildren(sheet, new Set(["topic"]))[0];
      if (!topic) continue;
      const root = _xmindXmlTopicToNode(topic, resourceMap);
      const titleEl = _xmlElementChildren(sheet).find((el) => _xmlLocalName(el) === "title");
      specs.push({ name: (titleEl && titleEl.textContent && titleEl.textContent.trim()) || root.text || fallbackTitle, root });
    }
    if (!specs.length) throw new Error("XMind XML did not contain a root topic");
    return _importMakeDocument(specs, fallbackTitle);
  }

  function importXmlMindmap(xmlText, fallbackTitle = "Mindmap") {
    const doc = new DOMParser().parseFromString(String(xmlText || ""), "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("The XML mind-map file could not be parsed");
    const rootEl = doc.documentElement;
    const rootLocal = _xmlLocalName(rootEl);

    if (rootLocal === "opml") {
      const body = Array.from(doc.getElementsByTagName("body"))[0];
      if (!body) throw new Error("OPML file has no body");
      const outlines = _xmlElementChildren(body).filter((el) => _xmlLocalName(el) === "outline");
      const convertOutline = (el) => ({
        text: el.getAttribute("text") || el.getAttribute("title") || el.getAttribute("_note") || "Topic",
        note: el.getAttribute("_note") ? `<p>${escapeHtml(el.getAttribute("_note"))}</p>` : null,
        children: _xmlElementChildren(el).filter((c) => _xmlLocalName(c) === "outline").map(convertOutline)
      });
      const specs = outlines.map((el) => { const root = convertOutline(el); return { name: root.text, root }; });
      return { document: _importMakeDocument(specs, fallbackTitle), formatLabel: "OPML" };
    }

    if (rootLocal === "map") {
      const rootNode = _xmlElementChildren(rootEl).find((el) => _xmlLocalName(el) === "node");
      if (rootNode) {
        const root = _xmlTopicToNode(rootNode, new Set(["node"]));
        return { document: _importMakeDocument([{ name: root.text || fallbackTitle, root }], fallbackTitle), formatLabel: "FreeMind / Freeplane" };
      }
    }

    const sheets = Array.from(doc.getElementsByTagNameNS("*", "sheet"));
    if (sheets.length) {
      const specs = [];
      for (const sheet of sheets) {
        const topic = _xmlNearestTopicChildren(sheet, new Set(["topic"]))[0];
        if (!topic) continue;
        const root = _xmlTopicToNode(topic, new Set(["topic"]));
        const titleEl = _xmlElementChildren(sheet).find((el) => _xmlLocalName(el) === "title");
        specs.push({ name: (titleEl && titleEl.textContent && titleEl.textContent.trim()) || root.text || fallbackTitle, root });
      }
      if (specs.length) return { document: _importMakeDocument(specs, fallbackTitle), formatLabel: "XMind XML" };
    }

    const accepted = new Set(["topic", "node", "outline"]);
    let topicRoot = null;
    if (accepted.has(rootLocal)) topicRoot = rootEl;
    if (!topicRoot) {
      const all = Array.from(doc.getElementsByTagName("*")).filter((el) => accepted.has(_xmlLocalName(el)));
      topicRoot = all[0] || null;
    }
    if (!topicRoot) throw new Error("No recognizable topic hierarchy was found in the XML file");
    const root = _xmlTopicToNode(topicRoot, new Set([_xmlLocalName(topicRoot)]));
    return { document: _importMakeDocument([{ name: root.text || fallbackTitle, root }], fallbackTitle), formatLabel: "XML mind map" };
  }

  async function importArchiveMindmap(filename, arrayBuffer) {
    const JSZip = window.JSZip;
    if (!JSZip) throw new Error("JSZip not loaded — cannot open archive-based mind-map files");
    const zip = await JSZip.loadAsync(arrayBuffer);
    const fallbackTitle = _importFileStem(filename);

    const exact = (path) => zip.file(path) || null;
    // XMind stores topic images inside the ZIP (resources/ in modern files,
    // attachments/ in older XMind 8 files). Decode those resources once so the
    // converter can attach the actual image bytes to the matching PKM node.
    const xmindResourceMap = await _xmindBuildResourceMap(zip);
    const contentJson = exact("content.json") || zip.file(/(^|\/)content\.json$/i)[0] || null;
    if (contentJson) {
      const parsed = JSON.parse(await contentJson.async("text"));
      return { document: importXMindJson(parsed, fallbackTitle, xmindResourceMap), formatLabel: "XMind" };
    }

    const mapJson = exact("map.json") || zip.file(/(^|\/)map\.json$/i)[0] || null;
    if (mapJson) {
      const parsed = JSON.parse(await mapJson.async("text"));
      if (parsed && parsed.map_version && parsed.root) {
        // Preserve MindMeister attachments when this is actually a .mind archive.
        const { mmJson, attachmentDataMap } = await loadMindFile(arrayBuffer);
        return { document: importMindMeister(mmJson, attachmentDataMap), formatLabel: "MindMeister" };
      }
      return importJsonMindmap(parsed, fallbackTitle);
    }

    const jsonEntries = zip.file(/\.(json|mup)$/i);
    for (const entry of jsonEntries.slice(0, 8)) {
      try {
        const parsed = JSON.parse(await entry.async("text"));
        return importJsonMindmap(parsed, fallbackTitle);
      } catch {}
    }

    const xmindContentXml = exact("content.xml") || zip.file(/(^|\/)content\.xml$/i)[0] || null;
    if (xmindContentXml && (String(filename || "").toLowerCase().endsWith(".xmind") || xmindResourceMap.size > 0)) {
      try {
        const xmlText = await xmindContentXml.async("text");
        return { document: importXMindXml(xmlText, fallbackTitle, xmindResourceMap), formatLabel: "XMind XML" };
      } catch {
        // Fall through: newer XMind archives can contain a placeholder content.xml.
      }
    }

    const preferredXml = [
      xmindContentXml,
      exact("Document.xml"),
      exact("document.xml"),
      ...zip.file(/(^|\/)(content|document|map|mindmap)\.(xml|opml|itm)$/i)
    ].filter(Boolean);
    const seen = new Set();
    const xmlEntries = [...preferredXml, ...zip.file(/\.(xml|opml|mm|itm)$/i)].filter((entry) => {
      const name = entry && entry.name;
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
    for (const entry of xmlEntries.slice(0, 12)) {
      try {
        return importXmlMindmap(await entry.async("text"), fallbackTitle);
      } catch {}
    }
    throw new Error("The archive did not contain a supported mind-map JSON or XML document");
  }

  async function importMindmapArrayBuffer(filename, arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer)) throw new Error("The imported file did not contain binary data");
    const lower = String(filename || "").toLowerCase();
    const fallbackTitle = _importFileStem(filename);
    const ext = (lower.split(".").pop() || "").toLowerCase();

    if (ext === "wmm") return { document: await loadWmmFile(arrayBuffer), formatLabel: "WMM", nativeWmm: true };
    if (ext === "mind") {
      const { mmJson, attachmentDataMap } = await loadMindFile(arrayBuffer);
      return { document: importMindMeister(mmJson, attachmentDataMap), formatLabel: "MindMeister" };
    }

    const bytes = new Uint8Array(arrayBuffer);
    const looksZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B;
    const archiveExts = new Set(["xmind", "mmap", "smmx", "itmz", "mom", "mindnode", "zip"]);
    if (looksZip || archiveExts.has(ext)) {
      try { return await importArchiveMindmap(filename, arrayBuffer); }
      catch (archiveError) {
        if (looksZip) throw archiveError;
      }
    }

    const text = _importText(arrayBuffer).trim();
    if (!text) throw new Error("The imported mind-map file is empty");
    if (text.startsWith("{") || text.startsWith("[") || ext === "json" || ext === "mup") {
      try { return importJsonMindmap(JSON.parse(text), fallbackTitle); }
      catch (jsonError) {
        if (text.startsWith("{") || text.startsWith("[")) throw jsonError;
      }
    }
    if (text.startsWith("<") || ["mm", "opml", "xml"].includes(ext)) {
      return importXmlMindmap(text, fallbackTitle);
    }
    throw new Error(`Unsupported or unrecognized mind-map format${ext ? ` (.${ext})` : ""}`);
  }

  function finishImportedDocument(state, fileName, result) {
    const json = result.document;
    jsonToMindmap(state, json);
    for (const node of state.nodes) {
      if (!node.attachments) continue;
      for (const att of node.attachments) {
        if (att.data) _persistAttach(att.id, att.data);
      }
    }
    reinflateAttachments(state);
    renderMapsList(state);
    centerMindmap(state, () => requestDraw(state));
    const active = getActiveMap(state);
    const label = result.formatLabel || "mind map";
    if (IS_OBSIDIAN) {
      setUnsavedChanges(state, !result.nativeWmm);
      if (!result.nativeWmm) postHost("dirty");
      postHost("title-changed", { title: active ? active.name : _importFileStem(fileName) });
      postHost("import-complete", { nativeWmm: !!result.nativeWmm, importedFormat: label, sourceName: fileName, convertToWmm: !result.nativeWmm });
    }
    const attCount = state.nodes.reduce((sum, node) => sum + ((node.attachments && node.attachments.length) || 0), 0);
    const relCount = Array.isArray(state.relLines) ? state.relLines.length : 0;
    const details = [];
    if (attCount > 0) details.push(`${attCount} attachment${attCount !== 1 ? "s" : ""}`);
    if (relCount > 0) details.push(`${relCount} relationship${relCount !== 1 ? "s" : ""}`);
    const detailNote = details.length ? ` (${details.join(", ")} loaded)` : "";
    showStatus(state, `${result.nativeWmm ? "Loaded" : "Imported"} ${label}: ${fileName}${detailNote}`);
  }

  function loadFromFile(state) {
    const input = document.getElementById("loadFileInput");
    if (!input) return;
    input.value = "";
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const result = await importMindmapArrayBuffer(file.name, await file.arrayBuffer());
        finishImportedDocument(state, file.name, result);
      } catch (error) {
        showStatus(state, "Failed to import mind map: " + (error && error.message ? error.message : String(error)), 6000);
      }
    };
    input.click();
  }

  async function saveToGist(state) {
    if (IS_OBSIDIAN) {
      postHost("save-request");
      return;
    }
    await saveAsLocalFile(state);
  }

  // ── input.js ───────────────────────────────────────────────────────────────

  function getCanvasRelativeCoords(state, clientX, clientY) {
    const rect = state.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return { x, y, canvasCoords: toCanvasCoords(state, x, y) };
  }

  function getTouchDistance(e) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function beginInteraction(state, screenX, screenY, mx, my, options = {}) {
    const { allowDoubleTapRename = false } = options;
    state.isPanning = true;
    state.panStartX = screenX - state.viewOffsetX;
    state.panStartY = screenY - state.viewOffsetY;
    const hitNode = findNodeAt(state, mx, my);
    if (!hitNode) {
      state.lastPointerDownNodeId = null;
      return;
    }
    state.lastPointerDownNodeId = hitNode.id;
    // Switch active map to the one containing the clicked node
    const hitNodeMap = getMapForNode(state, hitNode);
    if (hitNodeMap && hitNodeMap.id !== state.activeMapId) {
      state.activeMapId = hitNodeMap.id;
    }
    const dragX = Number.isFinite(hitNode.renderX) ? hitNode.renderX : hitNode.x;
    const dragY = Number.isFinite(hitNode.renderY) ? hitNode.renderY : hitNode.y;
    state.offsetX = mx - dragX;
    state.offsetY = my - dragY;
    state.draggingNode = hitNode;
    state.ghostX = dragX;
    state.ghostY = dragY;
    state.isDragging = false;
    state.selectedNode = hitNode;
    updateDeleteButton(state);
    state.isPanning = false;
    updatePartButtons(state);
    if (!allowDoubleTapRename) return;
    const now = Date.now();
    if (state.lastTapNode === hitNode && now - state.lastTapTime < 400) {
      showRenameInput(state, hitNode);
    }
    state.lastTapNode = hitNode;
    state.lastTapTime = now;
  }

  function updatePan(state, screenX, screenY) {
    if (!state.isPanning) return;
    state.viewOffsetX = screenX - state.panStartX;
    state.viewOffsetY = screenY - state.panStartY;
    requestDraw(state);
  }

  function isMapRootNode(state, node) {
    if (!node) return false;
    return (state.maps || []).some((map) => map && map.rootId === node.id);
  }

  function canAttachDraggedNode(state, draggedNode, candidateParent) {
    if (!draggedNode || !candidateParent) return false;
    if (draggedNode === candidateParent) return false;
    // A node can never become a child of one of its own descendants. Doing so
    // creates a cycle, detaches the branch from the traversable tree, and makes
    // the branch appear to disappear after auto-layout.
    if (isDescendantOrSelf(candidateParent, draggedNode)) return false;
    // Map roots define entries in state.maps. Reparenting a root would leave the
    // map registry pointing at a node that is no longer a root, so keep roots fixed.
    if (isMapRootNode(state, draggedNode)) return false;
    return true;
  }

  function handlePointerMove(state, mx, my, touchPadding = 0) {
    state.insertPosition = -1;
    state.potentialParent = null;
    const dragged = state.draggingNode;
    if (!dragged || isMapRootNode(state, dragged)) return;

    for (const zone of state.nodeZones) {
      if (zone.targetNode === dragged || zone.parent === dragged) continue;
      if (!canAttachDraggedNode(state, dragged, zone.parent)) continue;
      if (
        mx >= zone.x - touchPadding &&
        mx <= zone.x + zone.width + touchPadding &&
        my >= zone.y - touchPadding &&
        my <= zone.y + zone.height + touchPadding
      ) {
        state.potentialParent = zone.parent;
        if (zone.type === "before" || zone.type === "extended-before") {
          state.insertPosition = zone.actualIndex;
        } else if (zone.type === "after") {
          state.insertPosition = zone.actualIndex;
        } else if (zone.type === "child") {
          state.insertPosition = 0;
        }
        return;
      }
    }

    // Dropping directly on a node appends the dragged branch as a child. Never
    // consider a descendant of the dragged branch as a target.
    for (const node of state.nodes) {
      if (!canAttachDraggedNode(state, dragged, node)) continue;
      if (node.isInside(mx, my)) {
        state.potentialParent = node;
        state.insertPosition = node.children.length;
        return;
      }
    }
  }

  function updateDrag(state, mx, my, touchPadding = 0) {
    if (!state.draggingNode) return;
    const dx = mx - state.ghostX;
    const dy = my - state.ghostY;
    if (!state.isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      state.isDragging = true;
      state.showGhostNode = true;
    }
    if (!state.isDragging) return;
    state.ghostX = mx - state.offsetX;
    state.ghostY = my - state.offsetY;
    handlePointerMove(state, mx, my, touchPadding);
    requestDraw(state);
  }

  function completeDrag(state) {
    const wasDragging = state.isDragging;
    const dragged = state.draggingNode;
    if (!state.isDragging || !dragged) {
      state.potentialParent = null;
      state.insertPosition = -1;
      state.showGhostNode = false;
      state.draggingNode = null;
      state.isDragging = false;
      requestDraw(state);
      updateDeleteButton(state);
      return;
    }

    const candidateParent = state.potentialParent;
    if (isMapRootNode(state, dragged)) {
      showStatus(state, "Map root nodes cannot be attached under another node.", 4000);
    } else if (candidateParent && canAttachDraggedNode(state, dragged, candidateParent)) {
      const oldParent = dragged.parent;
      let adjustedInsertPosition = state.insertPosition;
      if (oldParent === candidateParent) {
        const originalIndex = candidateParent.children.indexOf(dragged);
        if (originalIndex >= 0 && originalIndex < adjustedInsertPosition) adjustedInsertPosition -= 1;
      }

      // Validate first, then mutate. This avoids orphaning a subtree if a drop
      // target is invalid or belongs to the dragged subtree itself.
      if (oldParent) {
        oldParent.children = oldParent.children.filter((child) => child !== dragged);
      }
      dragged.parent = candidateParent;
      candidateParent.collapsed = false;

      const existingIndex = candidateParent.children.indexOf(dragged);
      if (existingIndex >= 0) candidateParent.children.splice(existingIndex, 1);
      if (adjustedInsertPosition >= 0 && adjustedInsertPosition <= candidateParent.children.length) {
        candidateParent.children.splice(adjustedInsertPosition, 0, dragged);
      } else {
        candidateParent.children.push(dragged);
      }

      state.links = state.links.filter((link) => link.to !== dragged);
      state.links.push({ from: candidateParent, to: dragged });
      state.selectedNode = dragged;
      autoLayout(state);
      calculateInsertionZones(state);
      saveToHistory(state);
      postHost("dirty");
      showStatus(
        state,
        oldParent === candidateParent
          ? `Reordered “${dragged.text}”.`
          : `Moved “${dragged.text}” under “${candidateParent.text}”.`
      );
    } else if (candidateParent) {
      showStatus(state, "That drop would create an invalid parent/child cycle, so the branch was left unchanged.", 4500);
    }

    state.potentialParent = null;
    state.insertPosition = -1;
    state.showGhostNode = false;
    state.draggingNode = null;
    state.isDragging = false;
    state.lastDragEndAt = wasDragging ? Date.now() : state.lastDragEndAt;
    requestDraw(state);
    updateDeleteButton(state);
  }

  function handlePinchZoom(state, e) {
    if (e.touches.length !== 2 || !state.lastTouchDist) return false;
    const newDist = getTouchDistance(e);
    const zoomAmount = newDist / state.lastTouchDist;
    const rect = state.canvas.getBoundingClientRect();
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
    const mouse = toCanvasCoords(state, midX, midY);
    const newScale = Math.min(Math.max(state.viewScale * zoomAmount, 0.1), 4);
    state.viewOffsetX -= mouse.x * newScale - mouse.x * state.viewScale;
    state.viewOffsetY -= mouse.y * newScale - mouse.y * state.viewScale;
    state.viewScale = newScale;
    state.lastTouchDist = newDist;
    requestDraw(state);
    return true;
  }

  function addNode(state) {
    if (state.nodes.length === 0) {
      const mapId = state.activeMapId || "map_" + Date.now();
      const node = createNode(state, "New node");
      state.nodes.push(node);
      if (state.maps.length === 0) {
        state.maps.push({ id: mapId, name: node.text, rootId: node.id });
        state.activeMapId = mapId;
      }
      state.selectedNode = node;
      autoLayout(state);
      requestDraw(state);
      updateDeleteButton(state);
      saveToHistory(state);
      window.setTimeout(() => {
        node.width = node.calculateWidth();
        showRenameInput(state, node);
      }, 10);
      return;
    }
    if (!state.selectedNode) {
      const root = getActiveMapRoot(state) || state.nodes.find((n) => !n.parent);
      if (root) {
        state.selectedNode = root;
        updateDeleteButton(state);
      } else {
        showStatus(state, "Click a node first to add a child");
        return;
      }
    }
    const node = createNode(state, "New node");
    if (state.selectedNode.collapsed) state.selectedNode.collapsed = false;
    node.parent = state.selectedNode;
    state.selectedNode.children.push(node);
    state.links.push({ from: state.selectedNode, to: node });
    state.nodes.push(node);
    state.selectedNode = node;
    autoLayout(state);
    requestDraw(state);
    updateDeleteButton(state);
    saveToHistory(state);
    showRenameInput(state, node);
  }

  function deleteNode(state) {
    if (!state.selectedNode) {
      showStatus(state, "Select a node first");
      return;
    }
    // Prevent deleting a map root via the delete button — use Delete Map in the Maps panel
    if (!state.selectedNode.parent) {
      showStatus(state, "To delete an entire map, use the Maps panel (Maps button → trash icon).");
      return;
    }
    // For resolved nodes, capture the linked-reference root BEFORE removing the
    // node so we can write the post-deletion subtree to the registry before
    // autoLayout's resolveLinkedNodes call would otherwise restore it.
    const deletingResolved = !!state.selectedNode.resolvedFromPart;
    const refRoot = deletingResolved ? findLinkedRefRoot(state.selectedNode) : null;
    state.selectedNode.parent.children = state.selectedNode.parent.children.filter(
      (child) => child !== state.selectedNode
    );
    function removeNodeAndDescendants(node) {
      for (const child of [...node.children]) removeNodeAndDescendants(child);
      state.links = state.links.filter((link) => link.from !== node && link.to !== node);
      const nodeIndex = state.nodes.indexOf(node);
      if (nodeIndex > -1) state.nodes.splice(nodeIndex, 1);
    }
    removeNodeAndDescendants(state.selectedNode);
    if (state.focusNodeId === state.selectedNode?.id) state.focusNodeId = null;
    state.selectedNode = null;
    // Sync the registry with the deletion NOW — before autoLayout calls
    // resolveLinkedNodes which would rebuild from the (stale) registry.
    if (refRoot) syncLinkedRefToRegistry(state, refRoot);
    autoLayout(state);
    requestDraw(state);
    updateDeleteButton(state);
    saveToHistory(state);
  }

  function toggleCollapseSelected(state) {
    if (!state.selectedNode) { showStatus(state, "Select a node first"); return; }
    if (state.selectedNode.children.length === 0) { showStatus(state, "Selected node has no children"); return; }
    state.selectedNode.collapsed = !state.selectedNode.collapsed;
    autoLayout(state);
    requestDraw(state);
    saveToHistory(state);
  }

  function togglePinSelected(state) {
    if (!state.selectedNode) { showStatus(state, "Select a node first"); return; }
    state.selectedNode.pinned = !state.selectedNode.pinned;
    autoLayout(state);
    requestDraw(state);
    saveToHistory(state);
  }

  function cycleLayoutMode(state) {
    const modes = ["horizontal", "radial", "compact"];
    const idx = modes.indexOf(state.layoutMode);
    state.layoutMode = modes[(idx + 1) % modes.length];
    state.layoutTransitionActive = true;
    autoLayout(state);
    centerMindmap(state, () => requestDraw(state));
    requestDraw(state);
    saveToHistory(state);
    showStatus(state, `Layout: ${state.layoutMode}`);
  }

  function cycleBranchTheme(state) {
    const themes = ["Calm", "Vivid", "Minimal"];
    const idx = themes.indexOf(state.branchTheme);
    state.branchTheme = themes[(idx + 1) % themes.length];
    requestDraw(state);
    saveToHistory(state);
    showStatus(state, `Theme: ${state.branchTheme}`);
  }

  function toggleFocusForNode(state, node) {
    if (!node) return;
    state.focusNodeId = state.focusNodeId === node.id ? null : node.id;
    centerMindmap(state, () => requestDraw(state));
    requestDraw(state);
    showStatus(state, state.focusNodeId ? "Focus mode enabled" : "Focus mode cleared");
  }

  function toggleFocusSelected(state) {
    if (!state.selectedNode) { showStatus(state, "Select a node first"); return; }
    toggleFocusForNode(state, state.selectedNode);
  }

  function clearNodes(state) {
    state.nodes = [];
    state.links = [];
    state.maps = [];
    state.activeMapId = null;
    state.selectedNode = null;
    state.focusNodeId = null;
    requestDraw(state);
    updateDeleteButton(state);
    saveToHistory(state);
    showStatus(state, "Canvas cleared");
  }

  function moveNodeUp(state) {
    if (!state.selectedNode || !state.selectedNode.parent) return;
    const siblings = state.selectedNode.parent.children;
    const idx = siblings.indexOf(state.selectedNode);
    if (idx > 0) {
      [siblings[idx - 1], siblings[idx]] = [siblings[idx], siblings[idx - 1]];
      autoLayout(state);
      requestDraw(state);
      saveToHistory(state);
    }
  }

  function moveNodeDown(state) {
    if (!state.selectedNode || !state.selectedNode.parent) return;
    const siblings = state.selectedNode.parent.children;
    const idx = siblings.indexOf(state.selectedNode);
    if (idx < siblings.length - 1) {
      [siblings[idx], siblings[idx + 1]] = [siblings[idx + 1], siblings[idx]];
      autoLayout(state);
      requestDraw(state);
      saveToHistory(state);
    }
  }

  function showRenameInput(state, node) {
    const scale = state.viewScale;
    node.width = node.calculateWidth();
    const x = node.x * scale + state.viewOffsetX;
    const y = node.y * scale + state.viewOffsetY;
    setElementDisplay(state.renameInput, "block");
    state.renameInput.value = node.text;
    state.renameInput.style.left = `${x}px`;
    state.renameInput.style.top = `${y}px`;
    state.renameInput.style.width = `${node.width * scale}px`;
    state.renameInput.style.height = `${40 * scale}px`;
    state.renameInput.style.fontSize = `${14 * scale}px`;
    state.renameInput.style.lineHeight = `${40 * scale}px`;
    state.renameInput.style.borderRadius = `${10 * scale}px`;
    state.renameInput.style.paddingLeft = `${10 * scale}px`;
    state.renameInput.style.paddingRight = `${10 * scale}px`;
    window.setTimeout(() => {
      state.renameInput.focus();
      state.renameInput.select();
    }, 10);
    const originalText = node.text;
    state.renameInput.onblur = () => {
      const newText = state.renameInput.value.trim() || node.text;
      setElementDisplay(state.renameInput, "none");
      if (newText !== originalText) {
        node.text = newText;
        // Sync map name if this node is a map root
        const nodeMap = getMapForNode(state, node);
        if (nodeMap && nodeMap.rootId === node.id) nodeMap.name = newText;
        // For resolved nodes, write the rename to the registry BEFORE autoLayout
        // so resolveLinkedNodes rebuilds with the new text, not the old one.
        if (node.resolvedFromPart) {
          const refRoot = findLinkedRefRoot(node);
          if (refRoot) syncLinkedRefToRegistry(state, refRoot);
        }
        autoLayout(state);
        requestDraw(state);
        saveToHistory(state);
      }
    };
    state.renameInput.onkeydown = (event) => {
      if (event.key === "Enter") {
        state.renameInput.blur();
      } else if (event.key === "Escape") {
        state.renameInput.value = originalText;
        state.renameInput.blur();
      }
    };
  }

  /**
   * Returns the image attachment whose drawn rectangle contains the canvas-space
   * point (mx, my), using the same stacking geometry as drawNodeAttachmentImages.
   * Returns null when the point is not over any drawn image.
   */
  function getClickedImageAtt(node, mx, my) {
    if (!node.attachments || node.attachments.length === 0) return null;
    const imageAtts = node.attachments.filter((a) => a.type && a.type.startsWith("image/"));
    if (imageAtts.length === 0) return null;

    const nodeX = Number.isFinite(node.renderX) ? node.renderX : node.x;
    const nodeY = Number.isFinite(node.renderY) ? node.renderY : node.y;
    const TEXT_H = 40;
    const IMG_GAP = 8;
    let stackY = nodeY + TEXT_H + IMG_GAP;

    for (const att of imageAtts) {
      const img = _imgCache.get(att.id);
      if (!img || !img.complete || img.naturalWidth === 0) continue;
      const scale = Math.min(IMG_NODE_MAX_W / img.naturalWidth, IMG_NODE_MAX_H / img.naturalHeight, 1);
      const iw = Math.round(img.naturalWidth * scale);
      const ih = Math.round(img.naturalHeight * scale);
      const ix = nodeX + (node.width - iw) / 2;
      if (mx >= ix && mx <= ix + iw && my >= stackY && my <= stackY + ih) return att;
      stackY += ih + IMG_GAP;
    }
    return null;
  }

  // Returns the file-badge attachment under canvas-space point (mx, my), or null.
  function getClickedFileAtt(node, mx, my) {
    const fileAtts = getNodeFileAtts(node);
    if (fileAtts.length === 0) return null;

    const nodeX = Number.isFinite(node.renderX) ? node.renderX : node.x;
    const nodeY = Number.isFinite(node.renderY) ? node.renderY : node.y;
    const TEXT_H = 40;
    const IMG_GAP = 8;

    let stackY = nodeY + TEXT_H;
    if (node.attachments) {
      const imageAtts = node.attachments.filter((a) => a.type && a.type.startsWith("image/"));
      for (const att of imageAtts) {
        const img = _imgCache.get(att.id);
        if (!img || !img.complete || img.naturalWidth === 0) continue;
        const scale = Math.min(IMG_NODE_MAX_W / img.naturalWidth, IMG_NODE_MAX_H / img.naturalHeight, 1);
        stackY += IMG_GAP + Math.round(img.naturalHeight * scale);
      }
    }
    stackY += FILE_ATTACH_TOP_GAP;

    for (const att of fileAtts) {
      if (mx >= nodeX && mx <= nodeX + node.width && my >= stackY && my <= stackY + FILE_BADGE_H) {
        return att;
      }
      stackY += FILE_BADGE_H + FILE_BADGE_GAP;
    }
    return null;
  }

  // ── Relationship lines ─────────────────────────────────────────────────────

  const REL_COLORS = ["#16a34a", "#22c55e", "#6366f1", "#e11d48", "#d97706", "#0891b2", "#7c3aed", "#475569"];

  function getRelLineBezier(state, rl) {
    const fromNode = state.nodes.find((n) => n.id === rl.fromId);
    const toNode = state.nodes.find((n) => n.id === rl.toId);
    if (!fromNode || !toNode) return null;
    if (state.visibleNodeIds && (!state.visibleNodeIds.has(fromNode.id) || !state.visibleNodeIds.has(toNode.id))) return null;
    const fp = getNodeRenderPosition(fromNode);
    const tp = getNodeRenderPosition(toNode);
    // Node text-box centers
    const fcx = fp.x + fromNode.width / 2;
    const fcy = fp.y + 20;
    const tcx = tp.x + toNode.width / 2;
    const tcy = tp.y + 20;
    const dx = tcx - fcx, dy = tcy - fcy;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    // Exit edge on fromNode
    let fx, fy;
    if (adx > ady * (fromNode.width / 40)) {
      fx = dx >= 0 ? fp.x + fromNode.width : fp.x;
      fy = fcy;
    } else {
      fx = fcx;
      fy = dy >= 0 ? fp.y + 40 : fp.y;
    }
    // Entry edge on toNode
    let tx, ty;
    if (adx > ady * (toNode.width / 40)) {
      tx = dx >= 0 ? tp.x : tp.x + toNode.width;
      ty = tcy;
    } else {
      tx = tcx;
      ty = dy >= 0 ? tp.y : tp.y + 40;
    }
    // Quadratic bezier control point — arc bows clockwise-perpendicular
    const ldx = tx - fx, ldy = ty - fy;
    const ldist = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
    const arcH = Math.min(ldist * 0.55, 280);
    const cx = (fx + tx) / 2 + (ldy / ldist) * arcH + (rl.cpOffsetX || 0);
    const cy = (fy + ty) / 2 + (-ldx / ldist) * arcH + (rl.cpOffsetY || 0);
    return { fx, fy, cx, cy, tx, ty };
  }

  function getQBezierPoint(t, fx, fy, cx, cy, tx, ty) {
    const mt = 1 - t;
    return { x: mt * mt * fx + 2 * mt * t * cx + t * t * tx,
             y: mt * mt * fy + 2 * mt * t * cy + t * t * ty };
  }

  function drawArrowhead(ctx, tipX, tipY, dirX, dirY, size, color) {
    const len = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
    const ux = dirX / len, uy = dirY / len;
    const px = -uy, py = ux;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - ux * size + px * size * 0.45, tipY - uy * size + py * size * 0.45);
    ctx.lineTo(tipX - ux * size - px * size * 0.45, tipY - uy * size - py * size * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  function drawRelLines(state) {
    if (!state.relLines || state.relLines.length === 0) return;
    state._relLabelRects.clear();
    state._relCtrlPtRects.clear();
    const ctx = state.ctx;
    const ARROW = 10;
    for (const rl of state.relLines) {
      const bz = getRelLineBezier(state, rl);
      if (!bz) continue;
      const { fx, fy, cx, cy, tx, ty } = bz;
      const color = rl.color || "#6366f1";
      const sel = rl.id === state.selectedRelLineId;
      // Solid curved line (like MindMeister relationship lines)
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = sel ? 3 : 2.2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (sel) { ctx.shadowColor = color; ctx.shadowBlur = 10; }
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.quadraticCurveTo(cx, cy, tx, ty);
      ctx.stroke();
      ctx.restore();
      // Arrowheads (always solid, no dash)
      ctx.save();
      if (sel) { ctx.shadowColor = color; ctx.shadowBlur = 6; }
      if (rl.direction !== "backward") {
        drawArrowhead(ctx, tx, ty, tx - cx, ty - cy, ARROW, color);
      }
      if (rl.direction === "backward" || rl.direction === "both") {
        drawArrowhead(ctx, fx, fy, fx - cx, fy - cy, ARROW, color);
      }
      ctx.restore();
      // Label pill at midpoint if label exists; otherwise just a small invisible hit area
      const mid = getQBezierPoint(0.5, fx, fy, cx, cy, tx, ty);
      const lx = mid.x + (rl.labelOffsetX || 0);
      const ly = mid.y + (rl.labelOffsetY || 0);
      if (rl.label) {
        ctx.save();
        ctx.font = "600 11px system-ui";
        const tw = ctx.measureText(rl.label).width;
        const rw = tw + 18, rh = 22;
        const rx = lx - rw / 2, ry = ly - rh / 2;
        state._relLabelRects.set(rl.id, { x: rx, y: ry, w: rw, h: rh });
        ctx.fillStyle = sel ? color : "#fff";
        drawRoundedRectPath(ctx, rx, ry, rw, rh, 9);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        drawRoundedRectPath(ctx, rx, ry, rw, rh, 9);
        ctx.stroke();
        ctx.fillStyle = sel ? "#fff" : color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(rl.label, lx, ly);
        ctx.restore();
      } else {
        // No label: invisible hit area along the midpoint of the curve for click/drag
        const HIT = 10;
        state._relLabelRects.set(rl.id, { x: lx - HIT, y: ly - HIT, w: HIT * 2, h: HIT * 2 });
      }
      // When selected: draw a dashed guide line to the control point + a draggable handle circle
      if (sel) {
        const CP_R = 7;
        state._relCtrlPtRects.set(rl.id, { x: cx - CP_R, y: cy - CP_R, w: CP_R * 2, h: CP_R * 2 });
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo((fx + tx) / 2, (fy + ty) / 2);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff";
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(cx, cy, CP_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.restore();
      } else {
        state._relCtrlPtRects.delete(rl.id);
      }
    }
  }

  function hitTestRelLabel(state, mx, my) {
    for (const [lineId, r] of state._relLabelRects) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        return (state.relLines || []).find((rl) => rl.id === lineId) || null;
      }
    }
    return null;
  }

  function hitTestRelLine(state, mx, my) {
    const THRESH = 9;
    for (const rl of (state.relLines || [])) {
      const bz = getRelLineBezier(state, rl);
      if (!bz) continue;
      const { fx, fy, cx, cy, tx, ty } = bz;
      for (let t = 0; t <= 1; t += 0.04) {
        const mt = 1 - t;
        const px = mt * mt * fx + 2 * mt * t * cx + t * t * tx;
        const py = mt * mt * fy + 2 * mt * t * cy + t * t * ty;
        if (Math.hypot(px - mx, py - my) < THRESH) return rl;
      }
    }
    return null;
  }

  function hitTestRelCtrlPt(state, mx, my) {
    for (const [lineId, r] of (state._relCtrlPtRects || new Map())) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        return (state.relLines || []).find((rl) => rl.id === lineId) || null;
      }
    }
    return null;
  }

  function startRelLinePickMode(state) {
    if (!state.selectedNode) { showStatus(state, "Select a source node first"); return; }
    // Open the manage panel — from there the user can add new or edit existing relationships
    openRelManagePanel(state);
  }

  function cancelRelLinePickMode(state) {
    state.relLinePickMode = false;
    state.relLineSourceId = null;
    state.relLineMouseX = null;
    state.relLineMouseY = null;
    setElementCursor(state.canvas, "");
    requestDraw(state);
  }

  function setupCanvasEvents(state) {
    state.canvas.addEventListener("mousedown", (e) => {
      const { canvasCoords } = getCanvasRelativeCoords(state, e.clientX, e.clientY);
      // Resize handle takes precedence over normal node dragging.
      const resizeNode = hitTestNodeResizeHandle(state, canvasCoords.x, canvasCoords.y);
      if (resizeNode) {
        state.resizingNode = resizeNode;
        state.resizeStartMouseX = canvasCoords.x;
        state.resizeStartWidth = resizeNode.width;
        state.resizeDidChange = false;
        state.draggingNode = null;
        state.isDragging = false;
        state.isPanning = false;
        setElementCursor(state.canvas, "nwse-resize");
        e.preventDefault();
        return;
      }
      // Intercept rel label drag before normal node drag
      const hitLabel = hitTestRelLabel(state, canvasCoords.x, canvasCoords.y);
      if (hitLabel) {
        state.draggingRelLabel = {
          lineId: hitLabel.id,
          startMX: canvasCoords.x,
          startMY: canvasCoords.y,
          origOffsetX: hitLabel.labelOffsetX || 0,
          origOffsetY: hitLabel.labelOffsetY || 0
        };
        return;
      }
      // Check control-point handle drag (only visible when a line is selected)
      const hitCtrlPt = hitTestRelCtrlPt(state, canvasCoords.x, canvasCoords.y);
      if (hitCtrlPt) {
        state.draggingRelLine = {
          lineId: hitCtrlPt.id,
          startMX: canvasCoords.x,
          startMY: canvasCoords.y,
          origCpOffsetX: hitCtrlPt.cpOffsetX || 0,
          origCpOffsetY: hitCtrlPt.cpOffsetY || 0,
          moved: false
        };
        state._relLineDragMoved = false;
        return;
      }
      // Check dragging the line body itself to reshape it
      const hitLineBody = hitTestRelLine(state, canvasCoords.x, canvasCoords.y);
      if (hitLineBody) {
        state.draggingRelLine = {
          lineId: hitLineBody.id,
          startMX: canvasCoords.x,
          startMY: canvasCoords.y,
          origCpOffsetX: hitLineBody.cpOffsetX || 0,
          origCpOffsetY: hitLineBody.cpOffsetY || 0,
          moved: false
        };
        state._relLineDragMoved = false;
        return;
      }
      beginInteraction(state, e.clientX, e.clientY, canvasCoords.x, canvasCoords.y);
    });
    state.canvas.addEventListener("mousemove", (e) => {
      const { canvasCoords } = getCanvasRelativeCoords(state, e.clientX, e.clientY);
      // Live node resize: width changes with the pointer and draw() immediately
      // recomputes Unicode-aware wrapping and text-box height.
      if (state.resizingNode) {
        const requested = Math.min(
          MAX_NODE_WIDTH,
          Math.max(MIN_NODE_WIDTH, state.resizeStartWidth + (canvasCoords.x - state.resizeStartMouseX))
        );
        const before = state.resizingNode.customWidth;
        state.resizingNode.customWidth = requested;
        state.resizingNode.width = state.resizingNode.calculateWidth();
        if (!Number.isFinite(before) || Math.abs(before - requested) > 0.25) state.resizeDidChange = true;
        setElementCursor(state.canvas, "nwse-resize");
        requestDraw(state);
        return;
      }
      // Rel label drag
      if (state.draggingRelLabel) {
        const drl = state.draggingRelLabel;
        const rl = (state.relLines || []).find((r) => r.id === drl.lineId);
        if (rl) {
          rl.labelOffsetX = drl.origOffsetX + (canvasCoords.x - drl.startMX);
          rl.labelOffsetY = drl.origOffsetY + (canvasCoords.y - drl.startMY);
          requestDraw(state);
        }
        return;
      }
      // Rel line control-point drag
      if (state.draggingRelLine) {
        const drl = state.draggingRelLine;
        const rl = (state.relLines || []).find((r) => r.id === drl.lineId);
        if (rl) {
          rl.cpOffsetX = drl.origCpOffsetX + (canvasCoords.x - drl.startMX);
          rl.cpOffsetY = drl.origCpOffsetY + (canvasCoords.y - drl.startMY);
          if (Math.hypot(canvasCoords.x - drl.startMX, canvasCoords.y - drl.startMY) > 4) {
            drl.moved = true;
            state._relLineDragMoved = true;
          }
          setElementCursor(state.canvas, "grabbing");
          requestDraw(state);
        }
        return;
      }
      updatePan(state, e.clientX, e.clientY);
      updateDrag(state, canvasCoords.x, canvasCoords.y);
      if (state.relLinePickMode) {
        state.relLineMouseX = canvasCoords.x;
        state.relLineMouseY = canvasCoords.y;
        requestDraw(state);
      }
      if (!state.isDragging) {
        if (state.relLinePickMode) {
          setElementCursor(state.canvas, "crosshair");
        } else {
          const overResizeHandle = hitTestNodeResizeHandle(state, canvasCoords.x, canvasCoords.y);
          const hoverNode = findNodeAt(state, canvasCoords.x, canvasCoords.y);
          const overRelLabel = !hoverNode ? hitTestRelLabel(state, canvasCoords.x, canvasCoords.y) : null;
          const overRelLine = !hoverNode && !overRelLabel ? hitTestRelLine(state, canvasCoords.x, canvasCoords.y) : null;
          const overCtrlPt = !hoverNode && !overRelLabel ? hitTestRelCtrlPt(state, canvasCoords.x, canvasCoords.y) : null;
          const overImg = hoverNode ? getClickedImageAtt(hoverNode, canvasCoords.x, canvasCoords.y) : null;
          const overFile = !overImg && hoverNode ? getClickedFileAtt(hoverNode, canvasCoords.x, canvasCoords.y) : null;
          state.canvas.style.cursor = overResizeHandle ? "nwse-resize" : overCtrlPt ? "grab" : (overRelLabel || overRelLine) ? "pointer" : (overImg || overFile) ? (overImg ? "zoom-in" : "pointer") : "";
        }
      }
    });
    state.canvas.addEventListener("mouseup", () => {
      state.isPanning = false;
      if (state.resizingNode) {
        finishNodeResize(state);
        return;
      }
      if (state.draggingRelLabel) {
        state.draggingRelLabel = null;
        saveToHistory(state);
        return;
      }
      if (state.draggingRelLine) {
        const moved = state.draggingRelLine.moved;
        state.draggingRelLine = null;
        if (moved) {
          saveToHistory(state);
          state.lastDragEndAt = Date.now();
        }
        setElementCursor(state.canvas, "");
        return;
      }
      completeDrag(state);
    });
    window.addEventListener("mouseup", () => {
      if (state.resizingNode) {
        finishNodeResize(state);
        return;
      }
      // A release can occur outside the canvas while a node is being dragged.
      // Complete the move there as well so the interaction never gets stuck.
      if (state.draggingNode) {
        state.isPanning = false;
        completeDrag(state);
      }
    });

    state.canvas.addEventListener("click", (e) => {
      if (Date.now() - state.lastDragEndAt < 150) return;
      if (state._relLineDragMoved) { state._relLineDragMoved = false; return; }
      const { canvasCoords } = getCanvasRelativeCoords(state, e.clientX, e.clientY);
      // Pick mode: user clicked to select target node
      if (state.relLinePickMode) {
        const tgt = findNodeAt(state, canvasCoords.x, canvasCoords.y);
        const sourceId = state.relLineSourceId; // capture before cancel clears it
        cancelRelLinePickMode(state);
        if (tgt && tgt.id !== sourceId) {
          openRelPanel(state, { isNew: true, fromId: sourceId, toId: tgt.id });
        }
        return;
      }
      // Relationship line label/line click
      const hitRelLabel = hitTestRelLabel(state, canvasCoords.x, canvasCoords.y);
      const hitRelLine = !hitRelLabel ? hitTestRelLine(state, canvasCoords.x, canvasCoords.y) : null;
      if (hitRelLabel || hitRelLine) {
        const rl = hitRelLabel || hitRelLine;
        state.selectedRelLineId = rl.id;
        openRelPanel(state, { isNew: false, rl });
        requestDraw(state);
        return;
      }
      state.selectedRelLineId = null;
      const hitNode = findNodeAt(state, canvasCoords.x, canvasCoords.y);
      if (!hitNode) {
        state.selectedNode = null;
        updateDeleteButton(state);
        requestDraw(state);
        closeRelPanel(state);
        const attachPanel = document.getElementById("attachPanel");
        if (attachPanel) { attachPanel.classList.remove("visible"); if (state.attachBtn) state.attachBtn.classList.remove("active"); }
        updatePartButtons(state);
        return;
      }
      // If the click landed on a drawn image attachment, open the lightbox.
      const clickedAtt = getClickedImageAtt(hitNode, canvasCoords.x, canvasCoords.y);
      if (clickedAtt) {
        state.selectedNode = hitNode;
        updateDeleteButton(state);
        requestDraw(state);
        openAttachLightbox(clickedAtt);
        return;
      }
      // If the click landed on a file badge, download/open that file.
      const clickedFile = getClickedFileAtt(hitNode, canvasCoords.x, canvasCoords.y);
      if (clickedFile) {
        state.selectedNode = hitNode;
        updateDeleteButton(state);
        requestDraw(state);
        if (clickedFile.data) {
          downloadAttachment(clickedFile);
        } else if (clickedFile.url) {
          const safeUrl = sanitizeExternalUrl(clickedFile.url);
          if (safeUrl) window.open(safeUrl, "_blank", "noopener,noreferrer");
        }
        return;
      }
      state.selectedNode = hitNode;
      updateDeleteButton(state);
      requestDraw(state);
      refreshAttachPanelIfOpen(state);
      refreshNotePanelIfOpen(state);
      updatePartButtons(state);
    });
    state.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const zoomAmount = -e.deltaY * 0.001;
        const { canvasCoords } = getCanvasRelativeCoords(state, e.clientX, e.clientY);
        const newScale = Math.min(Math.max(state.viewScale * (1 + zoomAmount), 0.1), 4);
        state.viewOffsetX -= canvasCoords.x * newScale - canvasCoords.x * state.viewScale;
        state.viewOffsetY -= canvasCoords.y * newScale - canvasCoords.y * state.viewScale;
        state.viewScale = newScale;
        requestDraw(state);
      },
      { passive: false }
    );
    state.canvas.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2) {
          state.lastTouchDist = getTouchDistance(e);
          return;
        }
        const touch = e.touches[0];
        const { canvasCoords } = getCanvasRelativeCoords(state, touch.clientX, touch.clientY);
        beginInteraction(state, touch.clientX, touch.clientY, canvasCoords.x, canvasCoords.y, {
          allowDoubleTapRename: true
        });
      },
      { passive: false }
    );
    state.canvas.addEventListener(
      "touchmove",
      (e) => {
        e.preventDefault();
        if (handlePinchZoom(state, e)) return;
        if (e.touches.length === 0) return;
        const touch = e.touches[0];
        const { canvasCoords } = getCanvasRelativeCoords(state, touch.clientX, touch.clientY);
        updatePan(state, touch.clientX, touch.clientY);
        updateDrag(state, canvasCoords.x, canvasCoords.y, 10);
      },
      { passive: false }
    );
    state.canvas.addEventListener("touchend", () => {
      state.isPanning = false;
      state.lastTouchDist = null;
      completeDrag(state);
    });
    state.canvas.addEventListener("dblclick", (e) => {
      const { canvasCoords } = getCanvasRelativeCoords(state, e.clientX, e.clientY);
      const hitNode = findNodeAt(state, canvasCoords.x, canvasCoords.y);
      if (hitNode) showRenameInput(state, hitNode);
    });
    window.addEventListener("resize", () => {
      setCanvasSize(state);
      requestDraw(state);
    });
  }

  function setupToolbar(state) {
    function updateToolbarToggle() {
      if (window.innerWidth <= 600) {
        setElementDisplay(state.toolbarToggle, "inline-flex");
      } else {
        setElementDisplay(state.toolbarToggle, "none");
        state.toolbar.classList.remove("hidden");
      }
    }
    updateToolbarToggle();
    window.addEventListener("resize", updateToolbarToggle);
    state.toolbarToggle.addEventListener("click", () => {
      state.toolbar.classList.toggle("hidden");
    });
    if ("visualViewport" in window) {
      window.visualViewport.addEventListener("resize", () => {
        const keyboardVisible = window.visualViewport.height < window.innerHeight * 0.8;
        state.toolbar.classList.toggle("keyboard-active", keyboardVisible);
      });
    } else {
      document.addEventListener("focusin", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
          state.toolbar.classList.add("keyboard-active");
        }
      });
      document.addEventListener("focusout", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
          state.toolbar.classList.remove("keyboard-active");
        }
      });
    }
  }

  function setupKeyboardShortcuts(state) {
    document.addEventListener("keydown", (e) => {
      const targetTag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      const typing = targetTag === "input" || targetTag === "textarea" || e.target.isContentEditable;
      if (typing) return;
      if (e.key === "Escape") { if (state.relLinePickMode) { cancelRelLinePickMode(state); e.preventDefault(); return; } }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (IS_OBSIDIAN) postHost("save-as-request");
        else saveAsLocalFile(state);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveToGist(state); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(state); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteNode(state); return; }
      if (e.key.toLowerCase() === "n") { e.preventDefault(); addNode(state); return; }
      if (e.key.toLowerCase() === "c") { e.preventDefault(); centerMindmap(state, () => requestDraw(state)); return; }
      if (e.key.toLowerCase() === "l") { e.preventDefault(); cycleLayoutMode(state); return; }
      if (e.key.toLowerCase() === "f") { e.preventDefault(); toggleFocusSelected(state); return; }
      if (e.key.toLowerCase() === "p") { e.preventDefault(); togglePinSelected(state); return; }
      if (e.key.toLowerCase() === "x") { e.preventDefault(); toggleCollapseSelected(state); return; }
      if (e.key.toLowerCase() === "t") { e.preventDefault(); cycleBranchTheme(state); }
      if (e.key.toLowerCase() === "o") { e.preventDefault(); toggleNotePanel(state); }
      if (e.key.toLowerCase() === "r") { e.preventDefault(); startRelLinePickMode(state); }
    });
  }

  // ── Attachment panel ────────────────────────────────────────────────────────

  const ATTACH_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function getFileExt(name) {
    const parts = name.split(".");
    return parts.length > 1 ? parts[parts.length - 1].toUpperCase().slice(0, 4) : "FILE";
  }

  function isImageType(type) {
    return type && type.startsWith("image/");
  }

  function openAttachLightbox(att) {
    const lb = document.getElementById("attachLightbox");
    const img = document.getElementById("attachLightboxImg");
    const fname = document.getElementById("attachLightboxFilename");
    if (!lb || !img) return;
    img.src = att.data;
    img.alt = att.name;
    if (fname) fname.textContent = att.name;
    lb.classList.add("visible");
  }

  function closeAttachLightbox() {
    const lb = document.getElementById("attachLightbox");
    if (lb) lb.classList.remove("visible");
  }

  function downloadAttachment(att) {
    const a = document.createElement("a");
    a.href = att.data;
    a.download = att.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function renderAttachList(state) {
    const listEl = document.getElementById("attachList");
    if (!listEl) return;
    const node = state.selectedNode;
    const atts = (node && node.attachments) ? node.attachments : [];
    if (atts.length === 0) {
      listEl.innerHTML = "<div class=\"attach-empty\">No attachments yet.</div>";
      return;
    }
    listEl.innerHTML = "";
    for (const att of atts) {
      const item = document.createElement("div");
      item.className = "attach-item";
      // Thumbnail or icon
      let thumbHtml;
      if (isImageType(att.type)) {
        thumbHtml = `<img class="attach-item-thumb" src="${escHtml(att.data)}" alt="${escHtml(att.name)}" />`;
      } else {
        thumbHtml = `<div class="attach-item-icon">${escHtml(getFileExt(att.name))}</div>`;
      }
      item.innerHTML = `
        ${thumbHtml}
        <div class="attach-item-info">
          <div class="attach-item-name" title="${escHtml(att.name)}">${escHtml(att.name)}</div>
          <div class="attach-item-size">${att.size != null ? formatBytes(att.size) : ""}</div>
        </div>
        <div class="attach-item-actions">
          <button class="attach-view-btn" data-id="${escHtml(att.id)}" aria-label="View" title="View / Download"${(att.data || att.url) ? "" : " disabled"}>
            <svg viewBox="0 0 24 24" fill="none" width="13" height="13"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>
          </button>
          <button class="attach-remove-btn" data-id="${escHtml(att.id)}" aria-label="Remove">
            <svg viewBox="0 0 24 24" fill="none" width="12" height="12"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          </button>
        </div>`;
      listEl.appendChild(item);
    }
    // Bind view and remove
    listEl.querySelectorAll(".attach-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const att = (node.attachments || []).find((a) => a.id === id);
        if (!att) return;
        if (isImageType(att.type)) {
          openAttachLightbox(att);
        } else if (att.data) {
          downloadAttachment(att);
        } else if (att.url) {
          const safeUrl = sanitizeExternalUrl(att.url);
          if (safeUrl) window.open(safeUrl, "_blank", "noopener,noreferrer");
        }
      });
    });
    listEl.querySelectorAll(".attach-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        if (!node) return;
        _imgCache.delete(id);
        _dropAttach(id);  // remove from localStorage + IDB
        node.attachments = (node.attachments || []).filter((a) => a.id !== id);
        renderAttachList(state);
        requestDraw(state);
        saveToHistory(state);
      });
    });
  }

  function handleAttachFiles(state, files) {
    const node = state.selectedNode;
    if (!node) return;
    let added = 0;
    let skipped = 0;
    const process = (file) => new Promise((resolve) => {
      if (file.size > ATTACH_MAX_BYTES) {
        skipped++;
        resolve();
        return;
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (!node.attachments) node.attachments = [];
        const att = {
          id: "att_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          data: evt.target.result
        };
        node.attachments.push(att);
        _persistAttach(att.id, att.data);  // persist to localStorage (falls back to IDB for large files)
        added++;
        resolve();
      };
      reader.readAsDataURL(file);
    });
    Promise.all(Array.from(files).map(process)).then(() => {
      renderAttachList(state);
      requestDraw(state);
      saveToHistory(state);
      if (skipped > 0) {
        showStatus(state, `${skipped} file(s) skipped — exceeds 25 MB limit`);
      } else if (added > 0) {
        showStatus(state, `${added} attachment(s) added`);
      }
    });
  }

  function setupAttachPanel(state) {
    const panel = document.getElementById("attachPanel");
    const closeBtn = document.getElementById("attachPanelClose");
    const fileInput = document.getElementById("attachFileInput");
    const dropZone = document.getElementById("attachDropZone");
    const lbClose = document.getElementById("attachLightboxClose");
    const lbBackdrop = document.getElementById("attachLightboxBackdrop");
    if (!panel) return;

    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        panel.classList.remove("visible");
        if (state.attachBtn) state.attachBtn.classList.remove("active");
      });
    }
    if (fileInput) {
      fileInput.addEventListener("change", () => {
        if (fileInput.files && fileInput.files.length > 0) {
          handleAttachFiles(state, fileInput.files);
          fileInput.value = "";
        }
      });
    }
    if (dropZone) {
      dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
      });
      dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
      dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
          handleAttachFiles(state, e.dataTransfer.files);
        }
      });
    }
    if (lbClose) lbClose.addEventListener("click", closeAttachLightbox);
    if (lbBackdrop) lbBackdrop.addEventListener("click", closeAttachLightbox);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAttachLightbox();
    });
  }

  function toggleAttachPanel(state) {
    const panel = document.getElementById("attachPanel");
    if (!panel) return;
    const node = state.selectedNode;
    if (!node) { showStatus(state, "Select a node first"); return; }
    const isOpen = panel.classList.contains("visible");
    if (isOpen) {
      panel.classList.remove("visible");
      if (state.attachBtn) state.attachBtn.classList.remove("active");
    } else {
      const title = document.getElementById("attachPanelTitle");
      if (title) title.textContent = `Attachments — ${node.text}`;
      renderAttachList(state);
      panel.classList.add("visible");
      if (state.attachBtn) state.attachBtn.classList.add("active");
    }
  }

  function refreshAttachPanelIfOpen(state) {
    const panel = document.getElementById("attachPanel");
    if (panel && panel.classList.contains("visible")) {
      const node = state.selectedNode;
      const title = document.getElementById("attachPanelTitle");
      if (title && node) title.textContent = `Attachments — ${node.text}`;
      renderAttachList(state);
    }
  }

  function refreshNotePanelIfOpen(state) {
    const panel = document.getElementById("notePanel");
    if (!panel || !panel.classList.contains("visible")) return;
    const node = state.selectedNode;
    if (!node) { closeNotePanel(state); return; }
    void renderNotePanelForNode(state, node);
  }

  // ── AI / OpenRouter integration ──────────────────────────────────────────

  function collectSelectedNodeAIContext(state) {
    const node = state.selectedNode;
    if (!node) return null;
    const map = getMapForNode(state, node);
    const parent = node.parent || null;
    const path = [];
    let cursor = node;
    while (cursor) {
      path.unshift(cursor.text);
      cursor = cursor.parent;
    }
    return {
      nodeId: node.id,
      selectedNode: node.text,
      mapName: map ? map.name : null,
      path,
      parent: parent ? parent.text : null,
      children: (node.children || []).map((child) => child.text),
      siblings: parent
        ? parent.children.filter((sibling) => sibling !== node).map((sibling) => sibling.text)
        : []
    };
  }

  function normalizeAITask(task) {
    return ["suggestNodes", "expandBranch", "summarizeMap", "detectMissingConcepts"].includes(task)
      ? task
      : "suggestNodes";
  }

  function getAITaskLabel(task) {
    if (task === "expandBranch") return "Expand branch";
    if (task === "summarizeMap") return "Summarize map";
    if (task === "detectMissingConcepts") return "Detect missing concepts";
    return "Suggest child nodes";
  }

  function isMapLevelAITask(task) {
    return task === "summarizeMap" || task === "detectMissingConcepts";
  }

  function collectWholeMapAIContext(state) {
    const selectedNode = state.selectedNode || null;
    const selectedMap = selectedNode ? getMapForNode(state, selectedNode) : null;
    const map = selectedMap || getActiveMap(state);
    if (!map) return null;

    const root = state.nodes.find((node) => node.id === map.rootId) || null;
    if (!root) return null;

    const MAX_NODES = 500;
    const MAX_NOTE_CHARS = 700;
    const includedIds = new Set();
    let includedCount = 0;
    let totalNodeCount = 0;
    let leafCount = 0;
    let maxDepth = 0;

    function countTree(node, depth) {
      if (!node) return;
      totalNodeCount += 1;
      maxDepth = Math.max(maxDepth, depth);
      const children = Array.isArray(node.children) ? node.children : [];
      if (!children.length) leafCount += 1;
      for (const child of children) countTree(child, depth + 1);
    }
    countTree(root, 1);

    function buildTree(node, depth) {
      if (!node || includedCount >= MAX_NODES) return null;
      includedCount += 1;
      includedIds.add(node.id);
      const note = node.note ? noteHtmlToPlainText(node.note).slice(0, MAX_NOTE_CHARS) : "";
      const compact = {
        id: node.id,
        title: String(node.text || "").trim(),
        depth
      };
      if (Array.isArray(node.tags) && node.tags.length) compact.tags = node.tags.slice(0, 12);
      if (note) compact.note = note;
      const children = [];
      for (const child of Array.isArray(node.children) ? node.children : []) {
        if (includedCount >= MAX_NODES) break;
        const built = buildTree(child, depth + 1);
        if (built) children.push(built);
      }
      compact.children = children;
      return compact;
    }

    const tree = buildTree(root, 1);
    const relationships = (state.relLines || [])
      .filter((rel) => includedIds.has(rel.fromId) && includedIds.has(rel.toId))
      .slice(0, 250)
      .map((rel) => {
        const from = getNodeById(state, rel.fromId);
        const to = getNodeById(state, rel.toId);
        return {
          fromId: rel.fromId,
          from: from ? from.text : "",
          toId: rel.toId,
          to: to ? to.text : "",
          label: String(rel.label || "").trim(),
          direction: rel.direction || "forward"
        };
      });

    const selectedBelongsToMap = selectedNode && getMapForNode(state, selectedNode)?.id === map.id;
    return {
      mapId: map.id,
      mapName: map.name,
      rootNodeId: root.id,
      selectedNodeId: selectedBelongsToMap ? selectedNode.id : null,
      selectedNode: selectedBelongsToMap ? selectedNode.text : null,
      stats: {
        nodeCount: totalNodeCount,
        includedNodeCount: includedCount,
        maxDepth,
        leafCount,
        relationshipCount: relationships.length,
        truncated: includedCount < totalNodeCount
      },
      tree,
      relationships
    };
  }

  function closeAIMenu(state) {
    if (state.aiMenu) state.aiMenu.classList.remove("visible");
    if (state.aiBtn) state.aiBtn.classList.remove("active");
  }

  function positionAIMenu(state) {
    if (!state.aiMenu || !state.aiBtn) return;
    const rect = state.aiBtn.getBoundingClientRect();
    const menuWidth = 230;
    const left = Math.min(Math.max(10, rect.left - menuWidth / 2 + rect.width / 2), window.innerWidth - menuWidth - 10);
    const top = Math.min(window.innerHeight - 250, rect.bottom + 8);
    state.aiMenu.style.left = `${left}px`;
    state.aiMenu.style.top = `${Math.max(10, top)}px`;
  }

  function toggleAIMenu(state) {
    if (!state.aiMenu || !state.aiBtn) return;
    if (!state.selectedNode) {
      showStatus(state, "Select a node first");
      return;
    }
    const opening = !state.aiMenu.classList.contains("visible");
    closeAIMenu(state);
    if (opening) {
      positionAIMenu(state);
      state.aiMenu.classList.add("visible");
      state.aiBtn.classList.add("active");
    }
  }

  function showAIPanel(state) {
    if (state.aiSuggestionsPanel) state.aiSuggestionsPanel.classList.add("visible");
  }

  function hideAIPanel(state) {
    if (state.aiSuggestionsPanel) state.aiSuggestionsPanel.classList.remove("visible");
  }

  function setAIProgress(state, heading, detail) {
    if (!state.aiSuggestionsPanel) return;
    const title = state.aiSuggestionsPanel.querySelector(".pkm-ai-panel-title");
    const body = state.aiSuggestionsPanel.querySelector(".pkm-ai-panel-body");
    const actions = state.aiSuggestionsPanel.querySelector(".pkm-ai-panel-actions");
    if (title) title.textContent = heading;
    if (body) {
      body.empty ? body.empty() : (body.innerHTML = "");
      const loading = document.createElement("div");
      loading.className = "pkm-ai-loading";
      const spinner = document.createElement("div");
      spinner.className = "pkm-ai-spinner";
      const text = document.createElement("div");
      text.className = "pkm-ai-loading-text";
      text.textContent = detail || "Contacting AI…";
      loading.append(spinner, text);
      body.appendChild(loading);
    }
    if (actions) actions.style.display = "none";
    showAIPanel(state);
  }

  function requestAIForTask(state, requestedTask) {
    const task = normalizeAITask(requestedTask);
    const context = isMapLevelAITask(task)
      ? collectWholeMapAIContext(state)
      : collectSelectedNodeAIContext(state);

    if (!context) {
      showStatus(state, isMapLevelAITask(task) ? "Open a mind map first" : "Select a node first");
      return;
    }
    if (!IS_OBSIDIAN) {
      showStatus(state, "AI requests are available in the Obsidian plugin runtime.", 4500);
      return;
    }

    closeAIMenu(state);
    const requestId = "ai_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const taskLabel = getAITaskLabel(task);
    const timer = window.setTimeout(() => {
      const pending = _hostAIRequests.get(requestId);
      if (!pending) return;
      _hostAIRequests.delete(requestId);
      setAIProgress(state, taskLabel, "The AI request timed out. Check your OpenRouter connection and try again.");
    }, 180000);

    _hostAIRequests.set(requestId, {
      requestId,
      task,
      targetNodeId: context.nodeId || context.rootNodeId || null,
      context,
      streamedText: "",
      timer
    });

    const subject = isMapLevelAITask(task)
      ? `map “${context.mapName || "Untitled map"}”`
      : `“${context.selectedNode}”`;
    setAIProgress(state, taskLabel, `Analyzing ${subject}…`);
    postHost("ai-request", { requestId, task, context });
  }

  function requestAIForSelectedNode(state, task) {
    requestAIForTask(state, task);
  }

  function createAISuggestionRow(suggestion, index) {
    const row = document.createElement("label");
    row.className = "pkm-ai-suggestion-row";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    input.dataset.index = String(index);

    const content = document.createElement("div");
    content.className = "pkm-ai-suggestion-content";

    const title = document.createElement("div");
    title.className = "pkm-ai-suggestion-title";
    title.textContent = String(suggestion && suggestion.title ? suggestion.title : "Untitled suggestion");
    content.appendChild(title);

    if (suggestion && suggestion.reason) {
      const reason = document.createElement("div");
      reason.className = "pkm-ai-suggestion-reason";
      reason.textContent = String(suggestion.reason);
      content.appendChild(reason);
    }

    const children = Array.isArray(suggestion && suggestion.children) ? suggestion.children : [];
    if (children.length) {
      const childList = document.createElement("div");
      childList.className = "pkm-ai-child-preview";
      for (const child of children) {
        const childItem = document.createElement("div");
        childItem.textContent = `↳ ${String(child && child.title ? child.title : "Untitled")}`;
        childList.appendChild(childItem);
      }
      content.appendChild(childList);
    }

    row.append(input, content);
    return row;
  }

  function renderAISuggestions(state, pending, result) {
    if (!state.aiSuggestionsPanel) return;
    const title = state.aiSuggestionsPanel.querySelector(".pkm-ai-panel-title");
    const body = state.aiSuggestionsPanel.querySelector(".pkm-ai-panel-body");
    const actions = state.aiSuggestionsPanel.querySelector(".pkm-ai-panel-actions");
    const addButton = state.aiSuggestionsPanel.querySelector(".pkm-ai-add-selected");
    const regenButton = state.aiSuggestionsPanel.querySelector(".pkm-ai-regenerate");
    const suggestions = Array.isArray(result && result.suggestions) ? result.suggestions : [];

    if (title) {
      const label = pending.task === "expandBranch" ? "Expand branch" : "Suggested child nodes";
      title.textContent = `${label} — ${pending.context.selectedNode}`;
    }
    if (body) {
      body.empty ? body.empty() : (body.innerHTML = "");
      if (!suggestions.length) {
        const empty = document.createElement("div");
        empty.className = "pkm-ai-empty";
        empty.textContent = "The model returned no suggestions.";
        body.appendChild(empty);
      } else {
        suggestions.forEach((suggestion, index) => body.appendChild(createAISuggestionRow(suggestion, index)));
      }
    }
    state.aiCurrentResult = { pending, result };
    if (actions) actions.style.display = "flex";
    if (addButton) {
      addButton.style.display = "";
      addButton.textContent = "Add selected";
      addButton.disabled = suggestions.length === 0;
    }
    if (regenButton) regenButton.disabled = false;
    showAIPanel(state);
  }

  function updateAIPanelModelLabel(state, result) {
    if (!state.aiSuggestionsPanel) return;
    const eyebrow = state.aiSuggestionsPanel.querySelector(".pkm-ai-eyebrow");
    if (!eyebrow) return;
    const usedModel = result && result.meta && result.meta.usedModel ? String(result.meta.usedModel) : "";
    eyebrow.textContent = usedModel ? `AI via OpenRouter · ${usedModel}` : "AI via OpenRouter";
  }

  function appendAIListSection(body, heading, items) {
    if (!body || !Array.isArray(items) || !items.length) return;
    const section = document.createElement("section");
    section.className = "pkm-ai-result-section";
    const headingEl = document.createElement("div");
    headingEl.className = "pkm-ai-result-heading";
    headingEl.textContent = heading;
    section.appendChild(headingEl);
    const list = document.createElement("ul");
    list.className = "pkm-ai-result-list";
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = String(item || "");
      list.appendChild(li);
    }
    section.appendChild(list);
    body.appendChild(section);
  }

  function renderAIMapSummary(state, pending, result) {
    if (!state.aiSuggestionsPanel) return;
    const title = state.aiSuggestionsPanel.querySelector(".pkm-ai-panel-title");
    const body = state.aiSuggestionsPanel.querySelector(".pkm-ai-panel-body");
    const actions = state.aiSuggestionsPanel.querySelector(".pkm-ai-panel-actions");
    const addButton = state.aiSuggestionsPanel.querySelector(".pkm-ai-add-selected");
    const regenButton = state.aiSuggestionsPanel.querySelector(".pkm-ai-regenerate");

    updateAIPanelModelLabel(state, result);
    if (title) title.textContent = `Map summary — ${pending.context.mapName || "Untitled map"}`;
    if (body) {
      body.empty ? body.empty() : (body.innerHTML = "");

      const overview = document.createElement("div");
      overview.className = "pkm-ai-summary-overview";
      overview.textContent = String(result.summary || "No summary was returned.");
      body.appendChild(overview);

      const themes = Array.isArray(result.keyThemes) ? result.keyThemes : [];
      if (themes.length) {
        const section = document.createElement("section");
        section.className = "pkm-ai-result-section";
        const heading = document.createElement("div");
        heading.className = "pkm-ai-result-heading";
        heading.textContent = "Key themes";
        section.appendChild(heading);
        for (const theme of themes) {
          const card = document.createElement("div");
          card.className = "pkm-ai-theme-card";
          const themeTitle = document.createElement("div");
          themeTitle.className = "pkm-ai-theme-title";
          themeTitle.textContent = String(theme && theme.title ? theme.title : "Theme");
          card.appendChild(themeTitle);
          if (theme && theme.detail) {
            const detail = document.createElement("div");
            detail.className = "pkm-ai-theme-detail";
            detail.textContent = String(theme.detail);
            card.appendChild(detail);
          }
          section.appendChild(card);
        }
        body.appendChild(section);
      }

      appendAIListSection(body, "Key takeaways", Array.isArray(result.keyTakeaways) ? result.keyTakeaways : []);

      if (result.structure) {
        const section = document.createElement("section");
        section.className = "pkm-ai-result-section";
        const heading = document.createElement("div");
        heading.className = "pkm-ai-result-heading";
        heading.textContent = "Map structure";
        const text = document.createElement("div");
        text.className = "pkm-ai-structure-text";
        text.textContent = String(result.structure);
        section.append(heading, text);
        body.appendChild(section);
      }

      if (pending.context.stats && pending.context.stats.truncated) {
        const warning = document.createElement("div");
        warning.className = "pkm-ai-context-warning";
        warning.textContent = `Context was limited to ${pending.context.stats.includedNodeCount} of ${pending.context.stats.nodeCount} nodes for this request.`;
        body.appendChild(warning);
      }
    }

    state.aiCurrentResult = { pending, result };
    if (actions) actions.style.display = "flex";
    if (regenButton) regenButton.disabled = false;
    if (addButton) {
      addButton.style.display = "";
      addButton.disabled = false;
      addButton.textContent = "Copy summary";
    }
    showAIPanel(state);
  }

  function createAIGapRow(gap, index) {
    const row = document.createElement("label");
    row.className = "pkm-ai-suggestion-row pkm-ai-gap-row";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    input.dataset.gapIndex = String(index);

    const content = document.createElement("div");
    content.className = "pkm-ai-suggestion-content";

    const titleRow = document.createElement("div");
    titleRow.className = "pkm-ai-gap-title-row";
    const title = document.createElement("div");
    title.className = "pkm-ai-suggestion-title";
    title.textContent = String(gap && gap.title ? gap.title : "Untitled gap");
    const priority = document.createElement("span");
    const priorityValue = String(gap && gap.priority ? gap.priority : "medium").toLowerCase();
    priority.className = `pkm-ai-priority pkm-ai-priority-${priorityValue}`;
    priority.textContent = priorityValue;
    titleRow.append(title, priority);
    content.appendChild(titleRow);

    if (gap && gap.reason) {
      const reason = document.createElement("div");
      reason.className = "pkm-ai-suggestion-reason";
      reason.textContent = String(gap.reason);
      content.appendChild(reason);
    }

    const parent = document.createElement("div");
    parent.className = "pkm-ai-gap-parent";
    parent.textContent = `Suggested under: ${String(gap && gap.parentNodeTitle ? gap.parentNodeTitle : "map root")}`;
    content.appendChild(parent);

    row.append(input, content);
    return row;
  }

  function renderAIMissingConcepts(state, pending, result) {
    if (!state.aiSuggestionsPanel) return;
    const title = state.aiSuggestionsPanel.querySelector(".pkm-ai-panel-title");
    const body = state.aiSuggestionsPanel.querySelector(".pkm-ai-panel-body");
    const actions = state.aiSuggestionsPanel.querySelector(".pkm-ai-panel-actions");
    const addButton = state.aiSuggestionsPanel.querySelector(".pkm-ai-add-selected");
    const regenButton = state.aiSuggestionsPanel.querySelector(".pkm-ai-regenerate");
    const gaps = Array.isArray(result && result.gaps) ? result.gaps : [];

    updateAIPanelModelLabel(state, result);
    if (title) title.textContent = `Knowledge gaps — ${pending.context.mapName || "Untitled map"}`;
    if (body) {
      body.empty ? body.empty() : (body.innerHTML = "");
      if (result.analysis) {
        const intro = document.createElement("div");
        intro.className = "pkm-ai-summary-overview";
        intro.textContent = String(result.analysis);
        body.appendChild(intro);
      }
      if (!gaps.length) {
        const empty = document.createElement("div");
        empty.className = "pkm-ai-empty";
        empty.textContent = "No important missing concepts were identified.";
        body.appendChild(empty);
      } else {
        gaps.forEach((gap, index) => body.appendChild(createAIGapRow(gap, index)));
      }
      if (pending.context.stats && pending.context.stats.truncated) {
        const warning = document.createElement("div");
        warning.className = "pkm-ai-context-warning";
        warning.textContent = `Gap analysis used ${pending.context.stats.includedNodeCount} of ${pending.context.stats.nodeCount} nodes because the map is very large.`;
        body.appendChild(warning);
      }
    }

    state.aiCurrentResult = { pending, result };
    if (actions) actions.style.display = "flex";
    if (regenButton) regenButton.disabled = false;
    if (addButton) {
      addButton.style.display = "";
      addButton.textContent = "Add selected";
      addButton.disabled = gaps.length === 0;
    }
    showAIPanel(state);
  }

  function renderAIResult(state, pending, result) {
    if (pending.task === "summarizeMap") {
      renderAIMapSummary(state, pending, result);
      return;
    }
    if (pending.task === "detectMissingConcepts") {
      renderAIMissingConcepts(state, pending, result);
      return;
    }
    updateAIPanelModelLabel(state, result);
    renderAISuggestions(state, pending, result);
  }

  function createAIChildNode(state, parentNode, suggestion, depth = 0) {
    if (!suggestion || depth > 2) return 0;
    const title = String(suggestion.title || "").trim().replace(/\s+/g, " ").slice(0, 180);
    if (!title) return 0;
    const duplicate = (parentNode.children || []).some((child) => child.text.trim().toLowerCase() === title.toLowerCase());
    if (duplicate) return 0;

    const node = createNode(state, title);

    // Preserve the explanatory subtext shown in the AI suggestion card as the
    // new node's note. In Obsidian this inline note becomes the initial content
    // of the automatically linked Markdown note when the note is first opened.
    const reason = String(suggestion.reason || "").trim().slice(0, 2000);
    if (reason) node.note = `<p>${escapeHtml(reason)}</p>`;

    node.parent = parentNode;
    parentNode.children.push(node);
    state.links.push({ from: parentNode, to: node });
    state.nodes.push(node);
    let added = 1;

    const children = Array.isArray(suggestion.children) ? suggestion.children.slice(0, 4) : [];
    for (const child of children) added += createAIChildNode(state, node, child, depth + 1);
    return added;
  }

  function addAcceptedAISuggestions(state) {
    const current = state.aiCurrentResult;
    if (!current || !current.pending || !current.result) return;
    const parentNode = getNodeById(state, current.pending.targetNodeId);
    if (!parentNode) {
      showStatus(state, "The original node no longer exists.", 4000);
      hideAIPanel(state);
      return;
    }

    const suggestions = Array.isArray(current.result.suggestions) ? current.result.suggestions : [];
    const selectedIndexes = Array.from(state.aiSuggestionsPanel.querySelectorAll('.pkm-ai-suggestion-row input[type="checkbox"]:checked'))
      .map((input) => Number(input.dataset.index))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < suggestions.length);

    if (!selectedIndexes.length) {
      showStatus(state, "Select at least one AI suggestion to add.");
      return;
    }

    if (parentNode.collapsed) parentNode.collapsed = false;
    let added = 0;
    for (const index of selectedIndexes) added += createAIChildNode(state, parentNode, suggestions[index], 0);

    if (!added) {
      showStatus(state, "No new nodes were added; matching child nodes already exist.", 4500);
      return;
    }

    state.selectedNode = parentNode;
    autoLayout(state);
    calculateInsertionZones(state);
    requestDraw(state);
    updateDeleteButton(state);
    saveToHistory(state);
    postHost("dirty");
    hideAIPanel(state);
    showStatus(state, `Added ${added} AI-generated node${added === 1 ? "" : "s"}.`);
  }

  function addAcceptedAIGaps(state) {
    const current = state.aiCurrentResult;
    if (!current || !current.pending || !current.result) return;
    const gaps = Array.isArray(current.result.gaps) ? current.result.gaps : [];
    const selectedIndexes = Array.from(state.aiSuggestionsPanel.querySelectorAll('.pkm-ai-gap-row input[type="checkbox"]:checked'))
      .map((input) => Number(input.dataset.gapIndex))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < gaps.length);

    if (!selectedIndexes.length) {
      showStatus(state, "Select at least one missing concept to add.");
      return;
    }

    const root = getNodeById(state, current.pending.context.rootNodeId);
    let added = 0;
    for (const index of selectedIndexes) {
      const gap = gaps[index];
      let parent = getNodeById(state, Number(gap.parentNodeId));
      if (!parent || getNodeRootId(parent) !== current.pending.context.rootNodeId) parent = root;
      if (!parent) continue;
      if (parent.collapsed) parent.collapsed = false;
      added += createAIChildNode(state, parent, {
        title: gap.title,
        reason: gap.reason,
        children: []
      }, 0);
    }

    if (!added) {
      showStatus(state, "No new concepts were added; matching child nodes may already exist.", 4500);
      return;
    }

    autoLayout(state);
    calculateInsertionZones(state);
    requestDraw(state);
    updateDeleteButton(state);
    saveToHistory(state);
    postHost("dirty");
    hideAIPanel(state);
    showStatus(state, `Added ${added} missing concept${added === 1 ? "" : "s"} to the map.`);
  }

  function formatAIMapSummary(result, mapName) {
    const lines = [`# ${mapName || "Mind map"} — AI Summary`, "", String(result.summary || "").trim()];
    const themes = Array.isArray(result.keyThemes) ? result.keyThemes : [];
    if (themes.length) {
      lines.push("", "## Key themes");
      for (const theme of themes) {
        const title = String(theme && theme.title ? theme.title : "Theme").trim();
        const detail = String(theme && theme.detail ? theme.detail : "").trim();
        lines.push(`- **${title}**${detail ? ` — ${detail}` : ""}`);
      }
    }
    const takeaways = Array.isArray(result.keyTakeaways) ? result.keyTakeaways : [];
    if (takeaways.length) {
      lines.push("", "## Key takeaways");
      for (const takeaway of takeaways) lines.push(`- ${String(takeaway)}`);
    }
    if (result.structure) lines.push("", "## Map structure", String(result.structure));
    return lines.join("\n").trim();
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }

  function handleAIPrimaryAction(state) {
    const current = state.aiCurrentResult;
    if (!current || !current.pending) return;
    if (current.pending.task === "detectMissingConcepts") {
      addAcceptedAIGaps(state);
      return;
    }
    if (current.pending.task === "summarizeMap") {
      const markdown = formatAIMapSummary(current.result || {}, current.pending.context.mapName);
      void copyTextToClipboard(markdown).then(() => {
        showStatus(state, "Map summary copied to clipboard.");
      }).catch(() => {
        showStatus(state, "Could not copy the map summary.", 4000);
      });
      return;
    }
    addAcceptedAISuggestions(state);
  }

  function regenerateCurrentAIResult(state) {
    const current = state.aiCurrentResult;
    if (!current || !current.pending) return;
    if (!isMapLevelAITask(current.pending.task)) {
      const original = getNodeById(state, current.pending.targetNodeId);
      if (!original) {
        showStatus(state, "The original node no longer exists.", 4000);
        return;
      }
      state.selectedNode = original;
      updateDeleteButton(state);
      requestDraw(state);
    }
    requestAIForTask(state, current.pending.task);
  }

  function setupAIControls(state) {
    const contextPanel = state.nodeContextPanel || document.getElementById("nodeContextPanel");
    if (!contextPanel || document.getElementById("aiBtn")) return;

    const sep = document.createElement("span");
    sep.className = "ctx-sep";
    sep.setAttribute("aria-hidden", "true");
    contextPanel.appendChild(sep);

    const button = document.createElement("button");
    button.type = "button";
    button.id = "aiBtn";
    button.setAttribute("aria-label", "AI mind-map tools");
    button.setAttribute("data-tooltip", "AI Suggestions");
    button.innerHTML = '<svg class="button-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3zM18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    contextPanel.appendChild(button);
    state.aiBtn = button;

    const menu = document.createElement("div");
    menu.id = "pkmAiMenu";
    menu.className = "pkm-ai-menu";
    menu.innerHTML = '<button type="button" data-ai-task="suggestNodes"><strong>Suggest child nodes</strong><span>3–5 direct additions</span></button><button type="button" data-ai-task="expandBranch"><strong>Expand branch</strong><span>Add concepts plus one deeper level</span></button><div class="pkm-ai-menu-separator"></div><button type="button" data-ai-task="summarizeMap"><strong>Summarize map</strong><span>Analyze the whole-map context</span></button><button type="button" data-ai-task="detectMissingConcepts"><strong>Detect missing concepts</strong><span>Knowledge-gap analysis across the map</span></button>';
    document.body.appendChild(menu);
    state.aiMenu = menu;

    const panel = document.createElement("div");
    panel.id = "pkmAiSuggestionsPanel";
    panel.className = "pkm-ai-panel";
    panel.innerHTML = '<div class="pkm-ai-panel-header"><div><div class="pkm-ai-eyebrow">AI via OpenRouter</div><div class="pkm-ai-panel-title">AI suggestions</div></div><button type="button" class="pkm-ai-panel-close" aria-label="Close AI suggestions">×</button></div><div class="pkm-ai-panel-body"></div><div class="pkm-ai-panel-actions"><button type="button" class="pkm-ai-regenerate">Regenerate</button><button type="button" class="pkm-ai-add-selected">Add selected</button></div>';
    document.body.appendChild(panel);
    state.aiSuggestionsPanel = panel;

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleAIMenu(state);
    });
    menu.querySelectorAll("[data-ai-task]").forEach((item) => {
      item.addEventListener("click", () => requestAIForTask(state, item.dataset.aiTask));
    });
    panel.querySelector(".pkm-ai-panel-close").addEventListener("click", () => hideAIPanel(state));
    panel.querySelector(".pkm-ai-add-selected").addEventListener("click", () => handleAIPrimaryAction(state));
    panel.querySelector(".pkm-ai-regenerate").addEventListener("click", () => regenerateCurrentAIResult(state));
    document.addEventListener("click", (event) => {
      if (!menu.contains(event.target) && event.target !== button && !button.contains(event.target)) closeAIMenu(state);
    });
  }

  function handleAIHostMessage(state, msg) {
    if (msg.type === "ai-command") {
      requestAIForTask(state, normalizeAITask(msg.task));
      return true;
    }
    if (!msg.requestId) return false;
    const pending = _hostAIRequests.get(msg.requestId);
    if (!pending) return false;

    if (msg.type === "ai-start") {
      const label = getAITaskLabel(pending.task);
      const activity = pending.task === "summarizeMap"
        ? "summary"
        : pending.task === "detectMissingConcepts"
          ? "knowledge-gap analysis"
          : "structured suggestions";
      setAIProgress(state, label, msg.streaming ? `Streaming ${activity} from OpenRouter…` : "Waiting for OpenRouter…");
      return true;
    }
    if (msg.type === "ai-stream-delta") {
      pending.streamedText += typeof msg.delta === "string" ? msg.delta : "";
      const label = getAITaskLabel(pending.task);
      setAIProgress(state, label, `Receiving AI analysis… ${pending.streamedText.length} characters`);
      return true;
    }
    if (msg.type === "ai-response") {
      window.clearTimeout(pending.timer);
      _hostAIRequests.delete(msg.requestId);
      renderAIResult(state, pending, msg.result || {});
      return true;
    }
    if (msg.type === "ai-error") {
      window.clearTimeout(pending.timer);
      _hostAIRequests.delete(msg.requestId);
      const label = getAITaskLabel(pending.task);
      setAIProgress(state, label, `AI request failed: ${msg.message || "Unknown OpenRouter error"}`);
      return true;
    }
    return false;
  }

  function bindControls(state) {
    if (state.addBtn) state.addBtn.addEventListener("click", () => addNode(state));
    if (state.deleteBtn) state.deleteBtn.addEventListener("click", () => deleteNode(state));
    state.centerBtn.addEventListener("click", () => centerMindmap(state, () => requestDraw(state)));
    state.undoBtn.addEventListener("click", () => undo(state));
    state.clearBtn.addEventListener("click", () => clearNodes(state));
    state.saveBtn.addEventListener("click", () => saveToGist(state));
    if (state.loadBtn) state.loadBtn.addEventListener("click", () => loadFromFile(state));
    if (state.collapseBtn) state.collapseBtn.addEventListener("click", () => toggleCollapseSelected(state));
    if (state.focusBtn) state.focusBtn.addEventListener("click", () => toggleFocusSelected(state));
    if (state.layoutBtn) state.layoutBtn.addEventListener("click", () => cycleLayoutMode(state));
    if (state.pinBtn) state.pinBtn.addEventListener("click", () => togglePinSelected(state));
    if (state.themeBtn) state.themeBtn.addEventListener("click", () => cycleBranchTheme(state));
    if (state.savePartBtn) state.savePartBtn.addEventListener("click", () => void saveAsGlobalPart(state));
    if (state.pushPartBtn) state.pushPartBtn.addEventListener("click", () => pushPartUpdate(state));
    if (state.partsBtn) state.partsBtn.addEventListener("click", () => togglePartsPanel(state));
    if (state.pinRefBtn) state.pinRefBtn.addEventListener("click", () => pinRefInstance(state));
    if (state.tagBtn) state.tagBtn.addEventListener("click", () => toggleTagPanel(state));
    if (state.attachBtn) state.attachBtn.addEventListener("click", () => toggleAttachPanel(state));
    if (state.noteBtn) state.noteBtn.addEventListener("click", () => toggleNotePanel(state));
    if (state.relLinkBtn) state.relLinkBtn.addEventListener("click", () => startRelLinePickMode(state));
    if (state.toolbarMinBtn) {
      state.toolbarMinBtn.addEventListener("click", () => {
        state.toolbar.classList.add("minimized");
        if (state.toolbarRevealBtn) state.toolbarRevealBtn.classList.add("visible");
      });
    }
    if (state.toolbarRevealBtn) {
      state.toolbarRevealBtn.addEventListener("click", () => {
        state.toolbar.classList.remove("minimized");
        state.toolbarRevealBtn.classList.remove("visible");
      });
    }
    if (state.newMapBtn) state.newMapBtn.addEventListener("click", () => addNewMap(state));
    if (state.mapsBtn) state.mapsBtn.addEventListener("click", () => toggleMapsPanel(state));
    state.reorderUp.addEventListener("click", () => moveNodeUp(state));
    state.reorderDown.addEventListener("click", () => moveNodeDown(state));
    window.moveNodeUp = () => moveNodeUp(state);
    window.moveNodeDown = () => moveNodeDown(state);
  }

  // Migrate legacy single-key autosave → per-map storage (runs once on first load)
  function migrateOldAutosave() {
    if (!canUseLocalStorage()) return;
    try {
      const oldRaw = window.localStorage.getItem(AUTOSAVE_STORAGE_KEY);
      if (!oldRaw) return;
      const oldDoc = JSON.parse(oldRaw);
      if (!oldDoc || !oldDoc.mindmap) return;
      const maps = oldDoc.mindmap.maps || [];
      if (maps.length === 0) return;
      for (const mapData of maps) {
        const singleDoc = {
          version: oldDoc.version,
          savedAt: oldDoc.savedAt,
          gistId: oldDoc.gistId || null,
          mindmap: {
            maps: [mapData],
            activeMapId: mapData.id,
            layoutMode: oldDoc.mindmap.layoutMode,
            branchTheme: oldDoc.mindmap.branchTheme,
            viewScale: oldDoc.mindmap.viewScale,
            viewOffsetX: oldDoc.mindmap.viewOffsetX,
            viewOffsetY: oldDoc.mindmap.viewOffsetY
          }
        };
        window.localStorage.setItem(mapStorageKey(mapData.id), JSON.stringify(singleDoc));
        updateRegistryEntry(mapData.id, mapData.name || "Map");
      }
      window.localStorage.removeItem(AUTOSAVE_STORAGE_KEY);
    } catch {}
  }

  function initializeFromQuery(state) {
    setupAttachPanel(state);
    if (IS_OBSIDIAN) {
      const mapId = "map_" + Date.now();
      const mapName = "My Mindmap";
      const rootNode = createNode(state, mapName);
      state.nodes.push(rootNode);
      state.maps = [{ id: mapId, name: mapName, rootId: rootNode.id }];
      state.activeMapId = mapId;
      state.selectedNode = rootNode;
      autoLayout(state);
      centerMindmap(state, () => requestDraw(state));
      saveToHistory(state);
      state.history = [state.history[state.history.length - 1]];
      setUnsavedChanges(state, false);
      updateDeleteButton(state);
      postHost("title-changed", { title: mapName });
      return;
    }
    migrateOldAutosave();
    const urlParams = new URLSearchParams(window.location.search);
    const gistId = urlParams.get("gistId");
    if (gistId) loadFromGist(state, gistId);

    let mapId = urlParams.get("map");
    if (!mapId) {
      // No map in URL — redirect to first registered map, or create a default
      const registry = readRegistry();
      if (registry.length > 0) {
        window.location.href = "?map=" + registry[0].id;
        return;
      }
      mapId = "map_" + Date.now();
      history.replaceState(null, "", "?map=" + mapId);
    }

    state.activeMapId = mapId;
    if (recoverFromAutosave(state)) return;

    // No autosave for this map ID — create fresh content
    const registry = readRegistry();
    const entry = registry.find((m) => m.id === mapId);
    const mapName = entry ? entry.name : "My Mindmap";
    const rootNode = createNode(state, mapName);
    state.nodes.push(rootNode);
    state.maps = [{ id: mapId, name: mapName, rootId: rootNode.id }];
    state.activeMapId = mapId;
    state.selectedNode = rootNode;
    updateRegistryEntry(mapId, mapName);
    document.title = mapName + " — Mindmap Tool";
    autoLayout(state);
    centerMindmap(state, () => requestDraw(state));
    saveToHistory(state);
    state.history = [state.history[state.history.length - 1]];
    setUnsavedChanges(state, false);
    updateDeleteButton(state);
  }

  // ── global-map-parts ────────────────────────────────────────────────────────

  const GLOBAL_PARTS_KEY = "mindmap.globalParts.v1";
  let _obsidianGlobalParts = IS_OBSIDIAN
    ? cloneJson((window.__PKM_BOOTSTRAP__ && window.__PKM_BOOTSTRAP__.globalParts) || {})
    : null;

  function loadGlobalParts() {
    if (IS_OBSIDIAN) return cloneJson(_obsidianGlobalParts || {});
    try {
      if (!canUseLocalStorage()) return {};
      const raw = window.localStorage.getItem(GLOBAL_PARTS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function saveGlobalPartsToStorage(parts) {
    if (IS_OBSIDIAN) {
      _obsidianGlobalParts = cloneJson(parts || {});
      postHost("global-parts-changed", { parts: _obsidianGlobalParts });
      return;
    }
    if (!canUseLocalStorage()) return;
    // Strip attachment data from global parts before saving — image data URLs can
    // be hundreds of KB each and easily blow the localStorage quota.  Attachment
    // data is persisted separately under mindmap.att.<id> (same as map autosaves).
    // _persistAttach calls are done BEFORE the try block so a quota error on the
    // attachment key does not silently abort the GLOBAL_PARTS_KEY write.
    function persistSubtreeAttachments(node) {
      if (node.attachments) {
        for (const att of node.attachments) {
          if (att.data) _persistAttach(att.id, att.data);
        }
      }
      for (const child of (node.children || [])) persistSubtreeAttachments(child);
    }
    function stripSubtree(node) {
      return {
        text: node.text,
        attachments: (node.attachments && node.attachments.length > 0)
          ? node.attachments.map((att) => ({ id: att.id, type: att.type, name: att.name, size: att.size }))
          : node.attachments,
        note: node.note || undefined,
        noteFilePath: node.noteFilePath || undefined,
        children: (node.children || []).map(stripSubtree)
      };
    }
    // Persist all attachment data first (outside the try so a quota error there
    // does not prevent the registry JSON from being written).
    for (const part of Object.values(parts)) {
      if (part.subtree) persistSubtreeAttachments(part.subtree);
    }
    try {
      const stripped = {};
      for (const [id, part] of Object.entries(parts)) {
        stripped[id] = Object.assign({}, part, {
          subtree: part.subtree ? stripSubtree(part.subtree) : part.subtree
        });
      }
      window.localStorage.setItem(GLOBAL_PARTS_KEY, JSON.stringify(stripped));
    } catch {}
  }

  // Build a plain-object subtree from a node (excludes resolved children)
  function buildSubtree(node) {
    return {
      text: node.text,
      customWidth: Number.isFinite(node.customWidth) ? Math.round(node.customWidth) : undefined,
      attachments: (node.attachments && node.attachments.length > 0) ? node.attachments : undefined,
      note: node.note || undefined,
      noteFilePath: node.noteFilePath || undefined,
      children: node.children
        .filter((c) => !c.resolvedFromPart)
        .map((c) => buildSubtree(c))
    };
  }

  // Build subtree from ALL children (for pinned snapshot)
  // For SOURCE pushes: excludes resolvedFromPart children so the registry only
  // stores user-authored content (avoids capturing stale resolved nodes).
  function buildSubtreeAll(node) {
    return {
      text: node.text,
      customWidth: Number.isFinite(node.customWidth) ? Math.round(node.customWidth) : undefined,
      attachments: (node.attachments && node.attachments.length > 0) ? node.attachments : undefined,
      note: node.note || undefined,
      noteFilePath: node.noteFilePath || undefined,
      children: node.children.filter((c) => !c.resolvedFromPart).map((c) => buildSubtreeAll(c))
    };
  }

  // For REFERENCE pushes: includes ALL children (resolved ones ARE the canonical
  // content the user is promoting — filtering them would empty the registry).
  function buildSubtreeAllRaw(node) {
    return {
      text: node.text,
      customWidth: Number.isFinite(node.customWidth) ? Math.round(node.customWidth) : undefined,
      attachments: (node.attachments && node.attachments.length > 0) ? node.attachments : undefined,
      note: node.note || undefined,
      noteFilePath: node.noteFilePath || undefined,
      children: node.children.map((c) => buildSubtreeAllRaw(c))
    };
  }

  function createNodesFromPartData(state, nodeData, parent) {
    const node = createNode(state, nodeData.text);
    node.parent = parent;
    node.customWidth = Number.isFinite(nodeData.customWidth)
      ? Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, nodeData.customWidth))
      : null;
    node.width = node.calculateWidth();
    node.resolvedFromPart = true;
    node.note = nodeData.note ? sanitizeNoteHtml(nodeData.note) : null;
    node.noteFilePath = typeof nodeData.noteFilePath === "string" && nodeData.noteFilePath.trim()
      ? nodeData.noteFilePath.trim()
      : (typeof nodeData.noteTransferSource === "string" && nodeData.noteTransferSource.trim() ? nodeData.noteTransferSource.trim() : null);
    if (nodeData.attachments && nodeData.attachments.length > 0) {
      node.attachments = nodeData.attachments;
      // Ensure attachment data is persisted so images survive refresh
      for (const att of node.attachments) {
        if (att.data) _persistAttach(att.id, att.data);
      }
    }
    state.nodes.push(node);
    if (parent) {
      parent.children.push(node);
      state.links.push({ from: parent, to: node });
    }
    for (const childData of (nodeData.children || [])) {
      createNodesFromPartData(state, childData, node);
    }
    return node;
  }

  function removeSubtreeFromState(state, node) {
    for (const child of [...node.children]) {
      removeSubtreeFromState(state, child);
    }
    state.links = state.links.filter((l) => l.from !== node && l.to !== node);
    const idx = state.nodes.indexOf(node);
    if (idx > -1) state.nodes.splice(idx, 1);
  }

  function resolveLinkedNodes(state) {
    // Collect attachments added by the user to resolved nodes (keyed by node text),
    // so they survive the tear-down/rebuild cycle that happens on every autoLayout.
    function collectResolvedAttachments(nodes) {
      const map = new Map(); // text -> attachments[]
      function walk(n) {
        if (n.attachments && n.attachments.length > 0) {
          const existing = map.get(n.text);
          if (existing) {
            // Merge, deduplicate by id
            const ids = new Set(existing.map((a) => a.id));
            for (const a of n.attachments) { if (!ids.has(a.id)) existing.push(a); }
          } else {
            map.set(n.text, [...n.attachments]);
          }
        }
        for (const child of n.children) walk(child);
      }
      for (const n of nodes) walk(n);
      return map;
    }

    // After rebuilding, merge saved attachments back into the new resolved nodes.
    // If a saved attachment has the same ID as one already on the node (stripped
    // version from the registry), REPLACE it — the saved copy has the full data.
    function mergeResolvedAttachments(nodes, savedMap) {
      function walk(n) {
        if (savedMap.has(n.text)) {
          const saved = savedMap.get(n.text);
          if (!n.attachments) n.attachments = [];
          for (const a of saved) {
            const idx = n.attachments.findIndex((x) => x.id === a.id);
            if (idx >= 0) {
              // Replace the stripped registry version with the full-data version.
              n.attachments[idx] = a;
            } else {
              n.attachments.push(a);
            }
          }
        }
        for (const child of n.children) walk(child);
      }
      for (const n of nodes) walk(n);
    }

    const parts = loadGlobalParts();

    // Cleanup: source nodes are user-authoritative. If any of their children were
    // incorrectly flagged as resolvedFromPart (by the old duplicate bug), DEMOTE
    // them back to regular user-authored children — never delete them, because they
    // ARE the canonical content (e.g. Jack, Cold Showers on the Healthy Living source).
    function demoteResolvedSubtree(node) {
      node.resolvedFromPart = false;
      for (const child of node.children) demoteResolvedSubtree(child);
    }
    for (const node of state.nodes) {
      if (node.isGlobalPartSource) {
        for (const child of node.children) {
          if (child.resolvedFromPart) demoteResolvedSubtree(child);
        }
      }
    }

    // Skip nodes that ARE the Global Part source — their children are user-authored
    // and must never have resolved children injected alongside them.
    const linkedNodes = state.nodes.filter((n) => n.linkedPartId && !n.isGlobalPartSource);
    for (const node of linkedNodes) {
      const resolvedChildren = node.children.filter((c) => c.resolvedFromPart);
      // Save user-added attachments before tearing down
      const savedAttachments = collectResolvedAttachments(resolvedChildren);
      // Track the selected node so we can re-point after rebuild
      const selectedWasResolved = state.selectedNode && resolvedChildren.some(
        (c) => c === state.selectedNode || c.children.some(function findIn(n) {
          return n === state.selectedNode || n.children.some(findIn);
        })
      );
      const selectedText = selectedWasResolved && state.selectedNode ? state.selectedNode.text : null;
      // Before teardown: extract user-authored children from resolved nodes so
      // removeSubtreeFromState can't delete them.  We'll re-attach them after
      // the resolved subtree is rebuilt from the registry.
      // Map: resolvedNode.text → [user-authored direct children of that node]
      const savedUserChildren = new Map();
      function extractUserChildren(resolvedNode) {
        const userKids = resolvedNode.children.filter((c) => !c.resolvedFromPart);
        if (userKids.length > 0) {
          if (!savedUserChildren.has(resolvedNode.text)) savedUserChildren.set(resolvedNode.text, []);
          for (const k of userKids) savedUserChildren.get(resolvedNode.text).push(k);
          // Detach so removeSubtreeFromState does not recurse into them
          resolvedNode.children = resolvedNode.children.filter((c) => c.resolvedFromPart);
        }
        for (const child of resolvedNode.children) extractUserChildren(child);
      }
      for (const rc of resolvedChildren) extractUserChildren(rc);
      for (const child of resolvedChildren) removeSubtreeFromState(state, child);
      node.children = node.children.filter((c) => !c.resolvedFromPart);
      // Pinned instances use their stored snapshot; live instances use the registry
      let subtreeData;
      if (node.instanceState === "pinned" && node.pinnedSnapshot) {
        subtreeData = node.pinnedSnapshot;
      } else {
        const part = parts[node.linkedPartId];
        if (!part) continue;
        subtreeData = part.subtree;
      }
      for (const childData of (subtreeData.children || [])) {
        createNodesFromPartData(state, childData, node);
      }
      // Dedup: if a user-added child has the same text as a freshly resolved child,
      // remove the user-added copy. This handles the case where a child was saved as
      // user-authored on a reference node (e.g. Frost on Sports) and the registry
      // now also supplies the same child — preventing the "1.1 Frost / 1.2 Frost" duplicate.
      const resolvedTexts = new Set(node.children.filter((c) => c.resolvedFromPart).map((c) => c.text));
      const userDups = node.children.filter((c) => !c.resolvedFromPart && resolvedTexts.has(c.text));
      for (const dup of userDups) removeSubtreeFromState(state, dup);
      node.children = node.children.filter((c) => c.resolvedFromPart || !resolvedTexts.has(c.text));
      // Restore user-added attachments into the newly created resolved nodes
      if (savedAttachments.size > 0) {
        const newResolved = node.children.filter((c) => c.resolvedFromPart);
        mergeResolvedAttachments(newResolved, savedAttachments);
      }
      // Re-attach user-authored children that were detached before teardown
      if (savedUserChildren.size > 0) {
        function reattachUserChildren(resolvedNode) {
          const userKids = savedUserChildren.get(resolvedNode.text);
          if (userKids) {
            for (const kid of userKids) {
              kid.parent = resolvedNode;
              resolvedNode.children.push(kid);
              state.links.push({ from: resolvedNode, to: kid });
              // kid and its subtree are already in state.nodes (they were detached,
              // not removed from state), so no push to state.nodes is needed.
            }
          }
          for (const child of resolvedNode.children.filter((c) => c.resolvedFromPart)) {
            reattachUserChildren(child);
          }
        }
        for (const nr of node.children.filter((c) => c.resolvedFromPart)) {
          reattachUserChildren(nr);
        }
      }
      // Re-point selectedNode to the new counterpart (matched by text)
      if (selectedText !== null) {
        function findByText(nodes, text) {
          for (const n of nodes) {
            if (n.text === text) return n;
            const found = findByText(n.children, text);
            if (found) return found;
          }
          return null;
        }
        const newSel = findByText(node.children.filter((c) => c.resolvedFromPart), selectedText);
        if (newSel) state.selectedNode = newSel;
      }
    }
  }

  // Returns { live, pinned, total, nodes } for dependency tracking
  function getPartDependencies(state, partId) {
    const refs = state.nodes.filter((n) => n.linkedPartId === partId);
    const live = refs.filter((n) => n.instanceState !== "pinned");
    const pinned = refs.filter((n) => n.instanceState === "pinned");
    return { live: live.length, pinned: pinned.length, total: refs.length, nodes: refs };
  }

  function getNodeBreadcrumb(node) {
    const parts = [];
    let cur = node;
    while (cur) { parts.unshift(cur.text); cur = cur.parent; }
    return parts.join(" › ");
  }

  // Walks up the parent chain from node and returns the nearest ancestor (or
  // self) that is a live linked-part reference (has linkedPartId, is not a
  // source, and is not pinned). Returns null if none is found.
  function findLinkedRefRoot(node) {
    let cur = node;
    while (cur) {
      if (cur.linkedPartId && !cur.isGlobalPartSource && cur.instanceState !== "pinned") return cur;
      cur = cur.parent;
    }
    return null;
  }

  // Writes the current subtree of refNode to the registry immediately — BEFORE
  // autoLayout runs — so that resolveLinkedNodes reads the up-to-date registry
  // instead of restoring the stale version (e.g. bringing back a just-deleted node).
  // Also marks the entire subtree as resolvedFromPart so the subsequent
  // resolveLinkedNodes rebuild produces no duplicates.
  function syncLinkedRefToRegistry(state, refNode) {
    const partId = refNode.linkedPartId;
    if (!partId || refNode.instanceState === "pinned") return;
    const parts = loadGlobalParts();
    if (!parts[partId]) return;
    parts[partId].subtree = buildSubtreeAllRaw(refNode);
    parts[partId].updatedAt = Date.now();
    saveGlobalPartsToStorage(parts);
    function markResolved(n) { n.resolvedFromPart = true; n.children.forEach(markResolved); }
    refNode.children.forEach(markResolved);
  }

  // Silently syncs global-part changes to the registry whenever a source or
  // reference node's subtree is modified. Called automatically at the end of
  // saveToHistory so any add / attachment-change propagates to every live reference
  // (in the same tab immediately; other tabs receive the storage event).
  // Delete and rename use syncLinkedRefToRegistry directly (before autoLayout)
  // so they are already handled by the time this function runs.
  function autoSyncGlobalParts(state) {
    const parts = loadGlobalParts();
    if (Object.keys(parts).length === 0) return;
    let anyChanged = false;

    // Shape comparison includes text, attachment IDs (not data), and children
    // recursively. Attachment data URLs are excluded to avoid false positives
    // from reinflateAttachments.
    function shapeOf(node) {
      const attIds = (node.attachments || []).map((a) => a.id).join(",");
      const kids = (node.children || []).map(shapeOf).join("|");
      const noteShape = (node.note || "") + "|" + (node.noteFilePath || "");
      return node.text + (attIds ? "{" + attIds + "}" : "") + (noteShape !== "|" ? "<" + noteShape + ">" : "") + (kids ? "[" + kids + "]" : "");
    }

    // Recursively marks a node and its ENTIRE subtree as resolvedFromPart = true
    // so that resolveLinkedNodes teardown + rebuild runs cleanly with no duplicates.
    function markResolved(node) {
      node.resolvedFromPart = true;
      node.children.forEach(markResolved);
    }

    // 1. Sync from SOURCE nodes — user-authored children are always canonical.
    for (const sourceNode of state.nodes) {
      if (!sourceNode.isGlobalPartSource || sourceNode.resolvedFromPart) continue;
      const partId = sourceNode.isGlobalPartSource;
      if (!parts[partId]) continue;
      const newSubtree = buildSubtreeAll(sourceNode);
      if (shapeOf(parts[partId].subtree) !== shapeOf(newSubtree)) {
        parts[partId].subtree = newSubtree;
        parts[partId].updatedAt = Date.now();
        anyChanged = true;
      }
    }

    // 2. Sync from REFERENCE nodes whose live children differ from the registry.
    //    Compares only the children subtree (not the reference root's own text)
    //    so that user-renamed reference labels don't cause spurious syncs.
    //    Covers: new child nodes added at any depth, attachment add/remove on any
    //    resolved node. Delete and rename are handled by syncLinkedRefToRegistry
    //    (pre-autoLayout) so the registry is already up-to-date for those cases.
    for (const refNode of state.nodes) {
      if (!refNode.linkedPartId || refNode.isGlobalPartSource || refNode.instanceState === "pinned") continue;
      const partId = refNode.linkedPartId;
      if (!parts[partId]) continue;
      const liveChildrenShape = refNode.children.map(shapeOf).join("|");
      const registryChildrenShape = (parts[partId].subtree.children || []).map(shapeOf).join("|");
      if (liveChildrenShape !== registryChildrenShape) {
        parts[partId].subtree = buildSubtreeAllRaw(refNode);
        parts[partId].updatedAt = Date.now();
        // Mark the entire subtree as resolved so resolveLinkedNodes teardown +
        // rebuild produces no duplicates at any depth.
        refNode.children.forEach(markResolved);
        anyChanged = true;
      }
    }

    if (anyChanged) {
      saveGlobalPartsToStorage(parts);
      // autoLayout internally calls resolveLinkedNodes, rebuilding all live
      // references in this tab from the freshly written registry.
      autoLayout(state);
      requestDraw(state);
      renderPartsList(state);
    }
  }

  async function saveAsGlobalPart(state) {
    if (!state.selectedNode) { showStatus(state, "Select a node first"); return; }
    if (state.selectedNode.resolvedFromPart) {
      showStatus(state, "Cannot save a linked child as a Global Part");
      return;
    }
    const name = await requestTextPrompt({
      heading: "Save as Global Part",
      initialValue: state.selectedNode.text,
      placeholder: "Global Part name",
      submitLabel: "Save Part"
    });
    if (!name || !name.trim()) return;
    const partId = "part_" + Date.now();
    const parts = loadGlobalParts();
    parts[partId] = {
      id: partId,
      name: name.trim(),
      subtree: buildSubtreeAll(state.selectedNode),
      tags: [],
      createdAt: Date.now()
    };
    saveGlobalPartsToStorage(parts);
    state.selectedNode.isGlobalPartSource = partId;
    saveToHistory(state);
    requestDraw(state);
    updatePartButtons(state);
    renderPartsList(state);
    showStatus(state, "Saved \"" + name.trim() + "\" as a Global Part");
  }

  function insertGlobalPartReference(state, partId) {
    const parts = loadGlobalParts();
    const part = parts[partId];
    if (!part) { showStatus(state, "Global Part not found"); return; }
    if (!state.selectedNode) { showStatus(state, "Select a parent node first"); return; }
    if (state.selectedNode.resolvedFromPart) {
      showStatus(state, "Cannot insert reference inside a linked reference");
      return;
    }
    const node = createNode(state, part.name);
    node.parent = state.selectedNode;
    node.linkedPartId = partId;
    node.instanceState = "live";
    node.pinnedSnapshot = null;
    if (state.selectedNode.collapsed) state.selectedNode.collapsed = false;
    state.selectedNode.children.push(node);
    state.links.push({ from: state.selectedNode, to: node });
    state.nodes.push(node);
    state.selectedNode = node;
    autoLayout(state);
    requestDraw(state);
    updateDeleteButton(state);
    saveToHistory(state);
    showStatus(state, "Inserted linked reference to \"" + part.name + "\"");
  }

  // Toggle pin/unpin for the selected linked-reference node
  function pinRefInstance(state) {
    const node = state.selectedNode;
    if (!node || !node.linkedPartId) {
      showStatus(state, "Select a linked reference node to pin/unpin");
      return;
    }
    if (node.instanceState === "pinned") {
      node.instanceState = "live";
      node.pinnedSnapshot = null;
      resolveLinkedNodes(state);
      autoLayout(state);
      requestDraw(state);
      updatePartButtons(state);
      saveToHistory(state);
      showStatus(state, "\"" + node.text + "\" is now live-linked — updates with source");
    } else {
      const parts = loadGlobalParts();
      const part = parts[node.linkedPartId];
      if (!part) { showStatus(state, "Global Part not found"); return; }
      node.instanceState = "pinned";
      node.pinnedSnapshot = JSON.parse(JSON.stringify(part.subtree));
      requestDraw(state);
      updatePartButtons(state);
      saveToHistory(state);
      showStatus(state, "\"" + node.text + "\" pinned at current version");
    }
  }

  // Show impact preview modal, then call onConfirm if user proceeds
  function showImpactModal(state, partId, onConfirm) {
    const parts = loadGlobalParts();
    const part = parts[partId];
    if (!part) return;
    const deps = getPartDependencies(state, partId);
    const modal = document.getElementById("impactModal");
    const titleEl = document.getElementById("impactModalTitle");
    const body = document.getElementById("impactModalBody");
    const confirmBtn = document.getElementById("impactConfirmBtn");
    const cancelBtn = document.getElementById("impactCancelBtn");
    if (!modal) { onConfirm(); return; }

    if (titleEl) titleEl.textContent = "Push Update: " + part.name;

    let html = "";
    if (deps.live > 0) {
      html += "<div class=\"impact-group impact-live\">";
      html += "<span class=\"impact-group-label\">Will update (" + deps.live + " live-linked)</span><ul>";
      deps.nodes.filter((n) => n.instanceState !== "pinned").forEach((n) => {
        html += "<li>" + escHtml(getNodeBreadcrumb(n)) + "</li>";
      });
      html += "</ul></div>";
    } else {
      html += "<p class=\"impact-no-live\">No live-linked instances — nothing to update.</p>";
    }
    if (deps.pinned > 0) {
      html += "<div class=\"impact-group impact-pinned\">";
      html += "<span class=\"impact-group-label\">Will NOT update (" + deps.pinned + " pinned)</span><ul>";
      deps.nodes.filter((n) => n.instanceState === "pinned").forEach((n) => {
        html += "<li>" + escHtml(getNodeBreadcrumb(n)) + "</li>";
      });
      html += "</ul></div>";
    }
    if (body) body.innerHTML = html;
    modal.classList.add("visible");

    const cleanup = () => modal.classList.remove("visible");
    if (confirmBtn) confirmBtn.onclick = () => { cleanup(); onConfirm(); };
    if (cancelBtn) cancelBtn.onclick = () => { cleanup(); showStatus(state, "Push cancelled"); };
  }

  function pushPartUpdate(state) {
    const node = state.selectedNode;
    if (!node) { showStatus(state, "Select a node first"); return; }
    let partId;
    let isPushFromReference = false;
    if (node.isGlobalPartSource) {
      partId = node.isGlobalPartSource;
    } else if (node.linkedPartId && !node.resolvedFromPart && node.instanceState !== "pinned") {
      partId = node.linkedPartId;
      isPushFromReference = true;
    } else {
      showStatus(state, "Select a Global Part source or live reference node first");
      return;
    }
    const parts = loadGlobalParts();
    if (!parts[partId]) { showStatus(state, "Global Part not found in registry"); return; }
    showImpactModal(state, partId, () => {
      const freshParts = loadGlobalParts();
      if (!freshParts[partId]) return;
      // Source push: filter resolved children (user-authored only).
      // Reference push: capture ALL children — the resolved nodes are the content.
      freshParts[partId].subtree = isPushFromReference ? buildSubtreeAllRaw(node) : buildSubtreeAll(node);
      freshParts[partId].updatedAt = Date.now();
      saveGlobalPartsToStorage(freshParts);
      // Verify the registry write actually landed before mutating node state.
      // If the write silently failed, the registry still has the old subtree and
      // tearing down user-added children would leave the node permanently empty.
      const writtenParts = loadGlobalParts();
      // updatedAt was just set to Date.now(); if it round-trips through JSON
      // correctly, the save succeeded.  A mismatch means the setItem silently threw.
      const writeOk = writtenParts[partId] &&
        writtenParts[partId].updatedAt === freshParts[partId].updatedAt;
      // When pushing from a linked reference, any user-added (non-resolved) children
      // must be flagged as resolvedFromPart so autoLayout's resolveLinkedNodes call
      // tears them all down and rebuilds cleanly — preventing duplicates.
      // Only flag if we confirmed the write succeeded — otherwise leave them as
      // user-authored so they survive the resolveLinkedNodes rebuild.
      if (isPushFromReference && writeOk) {
        for (const child of node.children) child.resolvedFromPart = true;
      }
      autoLayout(state);
      reinflateAttachments(state);
      requestDraw(state);
      renderPartsList(state);
      showStatus(state, "Updated all live references to \"" + freshParts[partId].name + "\"");
    });
  }

  function deleteGlobalPart(state, partId) {
    const parts = loadGlobalParts();
    if (!parts[partId]) return;
    const name = parts[partId].name;
    delete parts[partId];
    saveGlobalPartsToStorage(parts);
    for (const node of state.nodes) {
      if (node.isGlobalPartSource === partId) node.isGlobalPartSource = null;
      if (node.linkedPartId === partId) node.linkedPartId = null;
    }
    resolveLinkedNodes(state);
    autoLayout(state);
    requestDraw(state);
    updatePartButtons(state);
    renderPartsList(state);
    showStatus(state, "Deleted Global Part \"" + name + "\"");
  }

  // ── Part tags ──

  function addTagToPart(state, partId, tag) {
    const t = tag.trim().toLowerCase();
    if (!t) return;
    const parts = loadGlobalParts();
    if (!parts[partId]) return;
    if (!parts[partId].tags) parts[partId].tags = [];
    if (!parts[partId].tags.includes(t)) {
      parts[partId].tags.push(t);
      saveGlobalPartsToStorage(parts);
      renderPartsList(state);
    }
  }

  function removeTagFromPart(state, partId, tag) {
    const parts = loadGlobalParts();
    if (!parts[partId]) return;
    parts[partId].tags = (parts[partId].tags || []).filter((t) => t !== tag);
    saveGlobalPartsToStorage(parts);
    renderPartsList(state);
  }

  // ── HTML/panel helpers ──

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderPartsList(state) {
    const container = document.getElementById("partsList");
    if (!container) return;
    const parts = loadGlobalParts();
    const partIds = Object.keys(parts);
    if (partIds.length === 0) {
      container.innerHTML = "<div class=\"parts-empty\">No global parts yet.<br>Select a node and click <strong>Save Part</strong>.</div>";
      return;
    }
    container.innerHTML = partIds.map((id) => {
      const part = parts[id];
      const deps = getPartDependencies(state, id);
      const depText = deps.total === 0 ? "No references" :
        (deps.live > 0 ? deps.live + " live" : "") +
        (deps.live > 0 && deps.pinned > 0 ? " · " : "") +
        (deps.pinned > 0 ? deps.pinned + " pinned" : "");
      const tagsHtml = (part.tags || []).length > 0
        ? "<div class=\"part-tags\">" +
          (part.tags || []).map((t) =>
            "<span class=\"part-tag-chip\" data-tag=\"" + escHtml(t) + "\" data-part=\"" + id + "\">" +
            escHtml(t) + "<button class=\"part-tag-remove\" aria-label=\"Remove\">×</button></span>"
          ).join("") + "</div>"
        : "";
      // Show thumbnail if root subtree node has an image attachment with data
      const rootAtts = part.subtree && part.subtree.attachments;
      const imgAtt = rootAtts && rootAtts.find((a) => a.type && a.type.startsWith("image/") && a.data);
      const thumbHtml = imgAtt
        ? "<img class=\"part-item-thumb\" src=\"" + escHtml(imgAtt.data) + "\" alt=\"" + escHtml(part.name) + "\" />"
        : "";
      return "<div class=\"part-item\">" +
        thumbHtml +
        "<div class=\"part-item-info\">" +
          "<span class=\"part-item-name\">" + escHtml(part.name) + "</span>" +
          "<span class=\"part-item-meta\">" + depText + "</span>" +
          tagsHtml +
          "<div class=\"part-tag-add-row\">" +
            "<input type=\"text\" class=\"part-tag-input\" data-part=\"" + id + "\" placeholder=\"+ tag\" maxlength=\"20\" autocomplete=\"off\"/>" +
          "</div>" +
        "</div>" +
        "<div class=\"part-item-actions\">" +
          "<button type=\"button\" class=\"part-insert-btn\" data-part-id=\"" + id + "\">" +
            "<svg viewBox=\"0 0 24 24\" fill=\"none\" width=\"11\" height=\"11\"><path d=\"M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><path d=\"M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>" +
            "Insert Ref" +
          "</button>" +
          "<button type=\"button\" class=\"part-delete-btn\" data-part-id=\"" + id + "\" title=\"Delete Part\">" +
            "<svg viewBox=\"0 0 24 24\" fill=\"none\" width=\"11\" height=\"11\"><path d=\"M18 6L6 18M6 6l12 12\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\"/></svg>" +
          "</button>" +
        "</div>" +
      "</div>";
    }).join("");
    container.querySelectorAll(".part-insert-btn").forEach((btn) => {
      btn.addEventListener("click", () => insertGlobalPartReference(state, btn.dataset.partId));
    });
    container.querySelectorAll(".part-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const part = loadGlobalParts()[btn.dataset.partId];
        if (part && await requestConfirmation({
          heading: "Delete global part",
          message: `Delete global part "${part.name}"?
All linked references will be unlinked.`,
          confirmLabel: "Delete"
        })) {
          deleteGlobalPart(state, btn.dataset.partId);
        }
      });
    });
    container.querySelectorAll(".part-tag-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const chip = btn.parentElement;
        removeTagFromPart(state, chip.dataset.part, chip.dataset.tag);
      });
    });
    container.querySelectorAll(".part-tag-input").forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          addTagToPart(state, input.dataset.part, input.value);
          input.value = "";
        }
      });
    });
  }

  function togglePartsPanel(state) {
    const panel = document.getElementById("partsPanel");
    const isVisible = panel.classList.toggle("visible");
    state.partsBtn.classList.toggle("active", isVisible);
    if (isVisible) renderPartsList(state);
  }

  // ── Multi-map operations ────────────────────────────────────────────────────

  function addNewMap(state) {
    if (IS_OBSIDIAN) {
      closeMapsPanel(state);
      postHost("new-map-tab-request", {
        suggestedName: "Map " + (state.maps.length + 1)
      });
      showStatus(state, "Opening a new PKM Mindmap tab...");
      return;
    }
    const registry = readRegistry();
    const name = window.prompt("Name for the new map:", "Map " + (registry.length + 1));
    if (!name || !name.trim()) return;
    const mapId = "map_" + Date.now();
    // Persist current state before opening the new map
    writeAutosave(state);
    // Register the new map so it appears in the panel on every page
    updateRegistryEntry(mapId, name.trim());
    // Open the new map in a new tab
    window.open("?map=" + mapId, "_blank", "noopener,noreferrer");
  }

  async function deleteActiveMap(state) {
    if (IS_OBSIDIAN) {
      if (state.maps.length <= 1) { showStatus(state, "Cannot delete the last map"); return; }
      const map = getActiveMap(state);
      if (!map) return;
      if (!(await requestConfirmation({ heading: "Delete map", message: `Delete map "${map.name}" and all its nodes?`, confirmLabel: "Delete" }))) return;
      const root = state.nodes.find((n) => n.id === map.rootId);
      const ids = new Set();
      (function collect(node) {
        if (!node) return;
        ids.add(node.id);
        for (const child of (node.children || [])) collect(child);
      })(root);
      state.nodes = state.nodes.filter((n) => !ids.has(n.id));
      state.links = state.links.filter((l) => !ids.has(l.from.id) && !ids.has(l.to.id));
      state.relLines = (state.relLines || []).filter((r) => !ids.has(r.fromId) && !ids.has(r.toId));
      state.maps = state.maps.filter((m) => m.id !== map.id);
      const nextMap = state.maps[0];
      state.activeMapId = nextMap.id;
      state.selectedNode = state.nodes.find((n) => n.id === nextMap.rootId) || null;
      state.focusNodeId = null;
      autoLayout(state);
      centerMindmap(state, () => requestDraw(state));
      saveToHistory(state);
      renderMapsList(state);
      postHost("title-changed", { title: nextMap.name });
      showStatus(state, `Deleted map "${map.name}"`);
      return;
    }
    const registry = readRegistry();
    if (registry.length <= 1) { showStatus(state, "Cannot delete the last map"); return; }
    const map = state.maps[0];
    if (!map) return;
    if (!(await requestConfirmation({ heading: "Delete map", message: `Delete map "${map.name}" and all its nodes?`, confirmLabel: "Delete" }))) return;
    removeFromRegistry(state.activeMapId);
    const remaining = readRegistry();
    window.location.href = remaining.length > 0 ? ("?map=" + remaining[0].id) : window.location.pathname;
  }

  async function renameActiveMap(state) {
    const map = IS_OBSIDIAN ? getActiveMap(state) : state.maps[0];
    if (!map) return;
    const newName = IS_OBSIDIAN
      ? await requestTextPrompt({ heading: "Rename map", initialValue: map.name, placeholder: "Map name", submitLabel: "Rename" })
      : window.prompt("Rename map:", map.name);
    if (!newName || !newName.trim()) return;
    map.name = newName.trim();
    // Also rename the root node
    const mapRoot = state.nodes.find((n) => n.id === map.rootId);
    if (mapRoot) mapRoot.text = newName.trim();
    if (!IS_OBSIDIAN) updateRegistryEntry(state.activeMapId, newName.trim());
    document.title = newName.trim() + " — Mindmap Tool";
    if (IS_OBSIDIAN) postHost("title-changed", { title: newName.trim() });
    autoLayout(state);
    requestDraw(state);
    saveToHistory(state);
    renderMapsList(state);
    showStatus(state, "Map renamed to: " + newName.trim());
  }

  function switchToMap(state, mapId, inNewTab = false) {
    if (IS_OBSIDIAN) {
      const map = state.maps.find((m) => m.id === mapId);
      if (!map) return;
      if (inNewTab) {
        const fullDocument = mindmapToJson(state, false);
        const mapDocument = {
          ...fullDocument,
          maps: fullDocument.maps.filter((entry) => entry.id === mapId),
          activeMapId: mapId
        };
        postHost("open-map-tab-request", {
          title: map.name,
          data: mapDocument
        });
        closeMapsPanel(state);
        showStatus(state, `Opening "${map.name}" in a new Obsidian tab...`);
        return;
      }
      if (mapId === state.activeMapId) { closeMapsPanel(state); return; }
      state.activeMapId = mapId;
      state.selectedNode = state.nodes.find((n) => n.id === map.rootId) || null;
      state.focusNodeId = null;
      updateDeleteButton(state);
      updatePartButtons(state);
      centerMindmap(state, () => requestDraw(state));
      renderMapsList(state);
      closeMapsPanel(state);
      postHost("title-changed", { title: map.name });
      return;
    }
    writeAutosave(state);
    const url = "?map=" + mapId;
    if (inNewTab) { window.open(url, "_blank", "noopener,noreferrer"); }
    else { window.location.href = url; }
  }

  function renderMapsList(state) {
    const list = document.getElementById("mapsList");
    if (!list) return;
    list.innerHTML = "";
    const registry = IS_OBSIDIAN
      ? state.maps.map((m) => ({ id: m.id, name: m.name }))
      : readRegistry();
    if (registry.length === 0) {
      list.innerHTML = '<p class="maps-list-empty">No maps yet.</p>';
      return;
    }
    for (const entry of registry) {
      const isActive = entry.id === state.activeMapId;
      const item = document.createElement("div");
      item.className = "map-item" + (isActive ? " active" : "");

      const label = document.createElement("span");
      label.className = "map-item-name";
      label.textContent = entry.name;
      label.addEventListener("click", () => switchToMap(state, entry.id));

      const actions = document.createElement("div");
      actions.className = "map-item-actions";

      const openBtn = document.createElement("button");
      openBtn.className = "map-action-btn map-action-btn--open";
      openBtn.title = IS_OBSIDIAN ? "Open in new Obsidian tab" : "Open in new tab";
      openBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
      openBtn.addEventListener("click", (e) => { e.stopPropagation(); switchToMap(state, entry.id, true); });

      const renameBtn = document.createElement("button");
      renameBtn.className = "map-action-btn";
      renameBtn.title = "Rename map";
      renameBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
      renameBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (isActive) {
          renameActiveMap(state);
        } else {
          const newName = IS_OBSIDIAN
            ? await requestTextPrompt({ heading: "Rename map", initialValue: entry.name, placeholder: "Map name", submitLabel: "Rename" })
            : window.prompt("Rename map:", entry.name);
          if (!newName || !newName.trim()) return;
          if (IS_OBSIDIAN) {
            const targetMap = state.maps.find((m) => m.id === entry.id);
            if (targetMap) {
              targetMap.name = newName.trim();
              const root = state.nodes.find((n) => n.id === targetMap.rootId);
              if (root) root.text = newName.trim();
              saveToHistory(state);
            }
          } else {
            updateRegistryEntry(entry.id, newName.trim());
          }
          renderMapsList(state);
        }
      });

      const delBtn = document.createElement("button");
      delBtn.className = "map-action-btn map-action-btn--delete";
      delBtn.title = "Delete map";
      delBtn.disabled = registry.length <= 1;
      delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (isActive) {
          deleteActiveMap(state);
        } else {
          const mapCount = IS_OBSIDIAN ? state.maps.length : readRegistry().length;
          if (mapCount <= 1) { showStatus(state, "Cannot delete the last map"); return; }
          if (!(await requestConfirmation({ heading: "Delete map", message: `Delete map "${entry.name}"?`, confirmLabel: "Delete" }))) return;
          if (IS_OBSIDIAN) {
            const target = state.maps.find((m) => m.id === entry.id);
            const root = target && state.nodes.find((n) => n.id === target.rootId);
            const ids = new Set();
            (function collect(node) {
              if (!node) return; ids.add(node.id);
              for (const child of (node.children || [])) collect(child);
            })(root);
            state.nodes = state.nodes.filter((n) => !ids.has(n.id));
            state.links = state.links.filter((l) => !ids.has(l.from.id) && !ids.has(l.to.id));
            state.relLines = (state.relLines || []).filter((r) => !ids.has(r.fromId) && !ids.has(r.toId));
            state.maps = state.maps.filter((m) => m.id !== entry.id);
            saveToHistory(state);
          } else {
            removeFromRegistry(entry.id);
          }
          renderMapsList(state);
          showStatus(state, `Deleted map "${entry.name}"`);
        }
      });

      actions.appendChild(openBtn);
      actions.appendChild(renameBtn);
      actions.appendChild(delBtn);
      item.appendChild(label);
      item.appendChild(actions);
      list.appendChild(item);
    }
  }

  function closeMapsPanel(state) {
    const panel = document.getElementById("mapsPanel");
    if (panel) panel.classList.remove("visible");
    if (state.mapsBtn) state.mapsBtn.classList.remove("active");
  }

  function toggleMapsPanel(state) {
    const panel = document.getElementById("mapsPanel");
    if (!panel) return;
    if (panel.classList.contains("visible")) {
      closeMapsPanel(state);
    } else {
      renderMapsList(state);
      panel.classList.add("visible");
      if (state.mapsBtn) state.mapsBtn.classList.add("active");
    }
  }

  function setupMapsPanel(state) {
    const closeBtn = document.getElementById("mapsPanelClose");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => closeMapsPanel(state));
    }
    const addInPanelBtn = document.getElementById("mapsPanelAddBtn");
    if (addInPanelBtn) {
      addInPanelBtn.addEventListener("click", () => addNewMap(state));
    }
    // Close when clicking outside the panel
    document.addEventListener("pointerdown", (e) => {
      const panel = document.getElementById("mapsPanel");
      if (!panel || !panel.classList.contains("visible")) return;
      if (!panel.contains(e.target) && e.target !== state.mapsBtn && !state.mapsBtn?.contains(e.target)) {
        closeMapsPanel(state);
      }
    }, { capture: true });
    renderMapsList(state);
  }

  function setupGlobalPartsPanel(state) {
    const closeBtn = document.getElementById("partsPanelClose");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        document.getElementById("partsPanel").classList.remove("visible");
        state.partsBtn.classList.remove("active");
      });
    }
    renderPartsList(state);
  }

  // ── Node tag panel ──

  function openTagPanel(state) {
    if (!state.selectedNode) { showStatus(state, "Select a node to add tags"); return; }
    renderTagChips(state);
    document.getElementById("tagPanel").classList.add("visible");
    state.tagBtn.classList.add("active");
    const input = document.getElementById("tagInput");
    if (input) { input.value = ""; input.focus(); }
  }

  function closeTagPanel(state) {
    document.getElementById("tagPanel").classList.remove("visible");
    state.tagBtn.classList.remove("active");
  }

  function toggleTagPanel(state) {
    const panel = document.getElementById("tagPanel");
    if (panel.classList.contains("visible")) closeTagPanel(state); else openTagPanel(state);
  }

  function renderTagChips(state) {
    const node = state.selectedNode;
    const title = document.getElementById("tagPanelTitle");
    const chips = document.getElementById("tagChips");
    if (!chips) return;
    if (!node) { if (chips) chips.innerHTML = "<span class=\"tag-chips-empty\">No node selected</span>"; return; }
    if (title) {
      const t = node.text.length > 22 ? node.text.slice(0, 22) + "…" : node.text;
      title.textContent = "Tags: " + t;
    }
    const tags = node.tags || [];
    if (tags.length === 0) {
      chips.innerHTML = "<span class=\"tag-chips-empty\">No tags — type below and press Enter</span>";
    } else {
      chips.innerHTML = tags.map((tag) =>
        "<span class=\"tag-chip\" data-tag=\"" + escHtml(tag) + "\">" +
        escHtml(tag) +
        "<button class=\"tag-chip-remove\" aria-label=\"Remove tag\">×</button></span>"
      ).join("");
      chips.querySelectorAll(".tag-chip-remove").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tag = btn.parentElement.dataset.tag;
          if (state.selectedNode) {
            state.selectedNode.tags = (state.selectedNode.tags || []).filter((t) => t !== tag);
            renderTagChips(state);
            requestDraw(state);
            saveToHistory(state);
          }
        });
      });
    }
  }

  // ── Relationship panel ─────────────────────────────────────────────────────

  function _getNodeLabel(state, id) {
    const n = state.nodes.find((nd) => nd.id === id);
    return n ? (n.text.length > 22 ? n.text.slice(0, 22) + "…" : n.text) : "Unknown";
  }

  function _showRelView(manageVisible) {
    const mv = document.getElementById("relManageView");
    const ev = document.getElementById("relEditView");
    if (mv) mv.style.display = manageVisible ? "flex" : "none";
    if (ev) ev.style.display = manageVisible ? "none" : "flex";
  }

  function openRelManagePanel(state) {
    const panel = document.getElementById("relPanel");
    if (!panel) return;
    const node = state.selectedNode;
    const titleEl = document.getElementById("relPanelTitle");
    const listEl = document.getElementById("relManageList");
    if (titleEl) titleEl.textContent = node ? `Relationships — ${node.text.length > 18 ? node.text.slice(0, 18) + "…" : node.text}` : "Relationships";
    if (listEl) {
      listEl.innerHTML = "";
      const rels = (state.relLines || []).filter((r) => node && (r.fromId === node.id || r.toId === node.id));
      if (rels.length === 0) {
        const empty = document.createElement("div");
        empty.className = "rel-manage-empty";
        empty.textContent = "No relationships yet.";
        listEl.appendChild(empty);
      } else {
        rels.forEach((rl) => {
          const otherId = rl.fromId === (node && node.id) ? rl.toId : rl.fromId;
          const otherLabel = _getNodeLabel(state, otherId);
          const dirSymbol = rl.direction === "both" ? "↔" : (rl.fromId === (node && node.id) ? "→" : "←");
          const item = document.createElement("div");
          item.className = "rel-manage-item";
          const dot = document.createElement("span");
          dot.className = "rel-manage-item-dot";
          dot.style.background = rl.color || "#6366f1";
          const lbl = document.createElement("span");
          lbl.className = "rel-manage-item-label";
          lbl.textContent = rl.label ? rl.label : otherLabel;
          lbl.title = rl.label ? `${rl.label} (${dirSymbol} ${otherLabel})` : `${dirSymbol} ${otherLabel}`;
          const dir = document.createElement("span");
          dir.className = "rel-manage-item-dir";
          dir.textContent = dirSymbol;
          const editBtn = document.createElement("button");
          editBtn.type = "button";
          editBtn.className = "rel-manage-item-edit";
          editBtn.textContent = "Edit";
          editBtn.addEventListener("click", () => { openRelPanel(state, { isNew: false, rl }); });
          const delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.className = "rel-manage-item-del";
          delBtn.textContent = "Delete";
          delBtn.addEventListener("click", () => {
            state.relLines = (state.relLines || []).filter((r) => r.id !== rl.id);
            if (state.selectedRelLineId === rl.id) state.selectedRelLineId = null;
            saveToHistory(state);
            requestDraw(state);
            openRelManagePanel(state); // refresh the list
          });
          item.appendChild(dot);
          item.appendChild(lbl);
          item.appendChild(dir);
          item.appendChild(editBtn);
          item.appendChild(delBtn);
          listEl.appendChild(item);
        });
      }
    }
    _showRelView(true);
    panel.classList.add("visible");
  }

  function openRelPanel(state, opts) {
    // opts: { isNew: true, fromId, toId } or { isNew: false, rl }
    const panel = document.getElementById("relPanel");
    if (!panel) return;
    state._relPanelOpts = opts;
    const titleEl = document.getElementById("relPanelTitle");
    const labelInput = document.getElementById("relLabelInput");
    const saveBtn = document.getElementById("relSaveBtn");
    const deleteBtn = document.getElementById("relDeleteBtn");
    const colorRow = document.getElementById("relColorRow");
    if (titleEl) titleEl.textContent = opts.isNew ? "New Relationship" : "Edit Relationship";
    if (labelInput) labelInput.value = opts.isNew ? "" : (opts.rl.label || "");
    const currentDir = opts.isNew ? "forward" : (opts.rl.direction || "forward");
    document.querySelectorAll(".rel-dir-btn").forEach((b) => b.classList.toggle("active", b.dataset.dir === currentDir));
    const currentColor = opts.isNew ? REL_COLORS[0] : (opts.rl.color || REL_COLORS[0]);
    if (colorRow) {
      colorRow.innerHTML = "";
      REL_COLORS.forEach((c) => {
        const sw = document.createElement("button");
        sw.type = "button";
        sw.className = "rel-color-swatch" + (c === currentColor ? " active" : "");
        sw.style.background = c;
        sw.dataset.color = c;
        sw.setAttribute("aria-label", c);
        sw.addEventListener("click", () => {
          colorRow.querySelectorAll(".rel-color-swatch").forEach((s) => s.classList.remove("active"));
          sw.classList.add("active");
        });
        colorRow.appendChild(sw);
      });
    }
    if (saveBtn) saveBtn.textContent = opts.isNew ? "Add" : "Save";
    if (deleteBtn) deleteBtn.classList.toggle("show", !opts.isNew);
    _showRelView(false);
    panel.classList.add("visible");
    if (labelInput) labelInput.focus();
  }

  function closeRelPanel(state) {
    const panel = document.getElementById("relPanel");
    if (panel) panel.classList.remove("visible");
    state._relPanelOpts = null;
  }

  function setupRelPanel(state) {
    const closeBtn = document.getElementById("relPanelClose");
    const saveBtn = document.getElementById("relSaveBtn");
    const deleteBtn = document.getElementById("relDeleteBtn");
    const labelInput = document.getElementById("relLabelInput");
    const addNewBtn = document.getElementById("relAddNewBtn");
    const backBtn = document.getElementById("relBackBtn");
    if (closeBtn) closeBtn.addEventListener("click", () => closeRelPanel(state));
    // Back button: return to manage view
    if (backBtn) backBtn.addEventListener("click", () => {
      state._relPanelOpts = null;
      openRelManagePanel(state);
    });
    // New Relationship button: start pick mode then close panel temporarily
    if (addNewBtn) addNewBtn.addEventListener("click", () => {
      if (!state.selectedNode) { showStatus(state, "Select a source node first"); return; }
      closeRelPanel(state);
      state.relLinePickMode = true;
      state.relLineSourceId = state.selectedNode.id;
      setElementCursor(state.canvas, "crosshair");
      requestDraw(state);
    });
    // Direction buttons — toggle active on click
    document.querySelectorAll(".rel-dir-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".rel-dir-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
    if (saveBtn) saveBtn.addEventListener("click", () => {
      const opts = state._relPanelOpts;
      if (!opts) return;
      const label = (labelInput ? labelInput.value.trim() : "");
      const dirBtn = document.querySelector(".rel-dir-btn.active");
      const direction = dirBtn ? dirBtn.dataset.dir : "forward";
      const colorSwatch = document.querySelector(".rel-color-swatch.active");
      const color = colorSwatch ? colorSwatch.dataset.color : REL_COLORS[0];
      if (opts.isNew) {
        state.relLines.push({
          id: "rl_" + Date.now(),
          fromId: opts.fromId, toId: opts.toId,
          label, color, direction,
          labelOffsetX: 0, labelOffsetY: 0
        });
        closeRelPanel(state);
      } else {
        const rl = (state.relLines || []).find((r) => r.id === opts.rl.id);
        if (rl) { rl.label = label; rl.direction = direction; rl.color = color; }
        // Return to manage view after saving edit
        openRelManagePanel(state);
      }
      state.selectedRelLineId = null;
      saveToHistory(state);
      requestDraw(state);
    });
    if (deleteBtn) deleteBtn.addEventListener("click", () => {
      const opts = state._relPanelOpts;
      if (!opts || opts.isNew) return;
      state.relLines = (state.relLines || []).filter((r) => r.id !== opts.rl.id);
      state.selectedRelLineId = null;
      // Return to manage view after delete
      openRelManagePanel(state);
      saveToHistory(state);
      requestDraw(state);
    });
    if (labelInput) {
      labelInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); saveBtn && saveBtn.click(); }
        if (e.key === "Escape") { e.preventDefault(); closeRelPanel(state); }
      });
    }
  }

  // ── Note panel ─────────────────────────────────────────────────────────────

  function setNoteStatus(message) {
    const status = document.getElementById("noteSaveStatus");
    if (status) status.textContent = message;
  }

  function closeNotePanel(state) {
    const panel = document.getElementById("notePanel");
    if (panel) panel.classList.remove("visible");
    if (state.noteBtn) state.noteBtn.classList.remove("active");
  }

  function renderNodeLinks(state) {
    const container = document.getElementById("noteLinksList");
    if (!container) return;
    container.innerHTML = "";
    const node = state.selectedNode;
    const links = (node && node.links) ? node.links : [];
    if (links.length === 0) return;
    const header = document.createElement("div");
    header.className = "note-links-header";
    header.textContent = "Links";
    container.appendChild(header);
    links.forEach((link) => {
      const url = link.url || link.href || (typeof link === "string" ? link : null);
      const label = link.title || link.label || link.text || url;
      const safeUrl = sanitizeExternalUrl(url);
      if (!safeUrl) return;
      const chip = document.createElement("a");
      chip.className = "note-link-chip";
      chip.href = safeUrl;
      chip.target = "_blank";
      chip.rel = "noopener noreferrer";
      chip.innerHTML = `<svg viewBox="0 0 16 16" fill="none" width="11" height="11"><path d="M6.5 9.5a4 4 0 005.5-5.5L10.5 2.5a4 4 0 00-5.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9.5 6.5a4 4 0 00-5.5 5.5L5.5 13.5a4 4 0 005.5-5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>${escapeHtml(label)}</span>`;
      container.appendChild(chip);
    });
  }

  function markdownToNoteHtml(value) {
    const source = String(value || "").replace(/\r\n?/g, "\n");
    const lines = source.split("\n");
    const output = [];
    let listType = null;

    function closeList() {
      if (listType) output.push(`</${listType}>`);
      listType = null;
    }

    function inline(text) {
      let safe = escapeHtml(text);
      safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      safe = safe.replace(/__([^_]+)__/g, "<strong>$1</strong>");
      safe = safe.replace(/\*([^*]+)\*/g, "<em>$1</em>");
      safe = safe.replace(/_([^_]+)_/g, "<em>$1</em>");
      safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
      return safe;
    }

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line.trim()) {
        closeList();
        continue;
      }
      const heading = line.match(/^#{1,6}\s+(.+)$/);
      if (heading) {
        closeList();
        output.push(`<h2>${inline(heading[1])}</h2>`);
        continue;
      }
      const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
      if (bullet) {
        if (listType !== "ul") { closeList(); listType = "ul"; output.push("<ul>"); }
        output.push(`<li>${inline(bullet[1])}</li>`);
        continue;
      }
      const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (numbered) {
        if (listType !== "ol") { closeList(); listType = "ol"; output.push("<ol>"); }
        output.push(`<li>${inline(numbered[1])}</li>`);
        continue;
      }
      closeList();
      output.push(`<p>${inline(line)}</p>`);
    }
    closeList();
    return sanitizeNoteHtml(output.join(""));
  }

  async function ensureMarkdownNoteForNode(state, node) {
    if (!node || !IS_OBSIDIAN) return null;
    const activeMap = getMapForNode(state, node) || getActiveMap(state);
    setNoteStatus(node.noteFilePath ? "Loading linked Markdown note…" : "Creating linked Markdown note…");
    const result = await requestHostNote("note-ensure-request", {
      nodeId: node.id,
      nodeTitle: node.text,
      mapTitle: activeMap ? activeMap.name : "Mindmap",
      noteFilePath: node.noteFilePath || "",
      initialContent: noteHtmlToMarkdown(node.note || "")
    });
    if (!result || result.ok !== true) throw new Error(result && result.error ? result.error : "Could not create the Markdown note");

    const oldPath = node.noteFilePath || null;
    node.noteFilePath = result.path || oldPath;
    if (typeof result.content === "string") {
      node.note = markdownToNoteHtml(result.content) || null;
    }
    if (node.noteFilePath !== oldPath) {
      setUnsavedChanges(state, true);
      postHost("dirty");
      saveToHistory(state);
    }
    return result;
  }

  async function writeMarkdownNoteForNode(state, node, markdown) {
    if (!node || !node.noteFilePath || !IS_OBSIDIAN) return;
    const result = await requestHostNote("note-write-request", {
      nodeId: node.id,
      nodeTitle: node.text,
      noteFilePath: node.noteFilePath,
      content: markdown
    });
    if (!result || result.ok !== true) throw new Error(result && result.error ? result.error : "Could not save the Markdown note");
    if (result.path) node.noteFilePath = result.path;
  }

  function scheduleMarkdownNoteWrite(state, node) {
    if (!IS_OBSIDIAN || !node || !node.noteFilePath) return;
    if (state.noteSyncTimer !== null) window.clearTimeout(state.noteSyncTimer);
    const editor = document.getElementById("noteEditor");
    const htmlSnapshot = editor ? sanitizeNoteHtml(editor.innerHTML) : sanitizeNoteHtml(node.note || "");
    state.noteSyncTimer = window.setTimeout(() => {
      state.noteSyncTimer = null;
      void writeMarkdownNoteForNode(state, node, noteHtmlToMarkdown(htmlSnapshot)).then(() => {
        if (state.selectedNode === node) setNoteStatus(`Saved to ${node.noteFilePath}`);
      }).catch((error) => {
        if (state.selectedNode === node) setNoteStatus("Markdown save failed: " + (error && error.message ? error.message : String(error)));
      });
    }, 500);
  }

  async function renderNotePanelForNode(state, node) {
    const panel = document.getElementById("notePanel");
    const editor = document.getElementById("noteEditor");
    const title = document.getElementById("notePanelTitle");
    const storageBadge = document.getElementById("noteStorageBadge");
    const sourceStatus = document.getElementById("noteSourceStatus");
    const pathEl = document.getElementById("noteFilePath");
    const openBtn = document.getElementById("noteOpenFileBtn");
    if (!panel || !editor) return;

    const shortTitle = node.text.length > 36 ? node.text.slice(0, 36) + "…" : node.text;
    if (title) title.textContent = shortTitle;
    if (storageBadge) storageBadge.textContent = IS_OBSIDIAN ? "Markdown" : "Inline";

    if (IS_OBSIDIAN) {
      try {
        await ensureMarkdownNoteForNode(state, node);
      } catch (error) {
        setNoteStatus("Could not prepare Markdown note: " + (error && error.message ? error.message : String(error)));
      }
    }

    if (sourceStatus) sourceStatus.textContent = IS_OBSIDIAN
      ? "Automatically linked to an Obsidian Markdown note"
      : "Stored inside this mindmap node";
    if (pathEl) pathEl.textContent = node.noteFilePath || "";
    if (openBtn) {
      openBtn.disabled = !IS_OBSIDIAN || !node.noteFilePath;
      openBtn.title = node.noteFilePath ? `Open ${node.noteFilePath}` : "Markdown note is created when this note panel opens";
    }

    editor.innerHTML = sanitizeNoteHtml(node.note || "");
    renderNodeLinks(state);
    setNoteStatus(IS_OBSIDIAN && node.noteFilePath
      ? `Linked Markdown: ${node.noteFilePath}`
      : "Inline note is saved with this map file.");
  }

  function openNotePanel(state) {
    const node = state.selectedNode;
    if (!node) return;
    const panel = document.getElementById("notePanel");
    if (!panel) return;
    panel.classList.add("visible");
    if (state.noteBtn) state.noteBtn.classList.add("active");
    void renderNotePanelForNode(state, node).then(() => {
      if (state.selectedNode !== node) return;
      const target = document.getElementById("noteEditor");
      if (target) target.focus();
    });
  }

  function toggleNotePanel(state) {
    const panel = document.getElementById("notePanel");
    if (panel && panel.classList.contains("visible")) closeNotePanel(state);
    else openNotePanel(state);
  }

  async function openLinkedMarkdownNote(state) {
    const node = state.selectedNode;
    if (!node || !node.noteFilePath || !IS_OBSIDIAN) return;
    try {
      const result = await requestHostNote("note-open-request", { noteFilePath: node.noteFilePath });
      if (!result || result.ok !== true) throw new Error(result && result.error ? result.error : "Could not open Markdown note");
    } catch (error) {
      setNoteStatus("Could not open Markdown note: " + (error && error.message ? error.message : String(error)));
    }
  }

  function setupNotePanel(state) {
    const closeBtn = document.getElementById("notePanelClose");
    if (closeBtn) closeBtn.addEventListener("click", () => closeNotePanel(state));

    const editor = document.getElementById("noteEditor");
    if (editor) {
      editor.addEventListener("paste", (event) => {
        event.preventDefault();
        const text = event.clipboardData ? event.clipboardData.getData("text/plain") : "";
        document.execCommand("insertText", false, text);
      });
      editor.addEventListener("input", () => {
        if (state.selectedNode) {
          const html = editor.innerHTML;
          state.selectedNode.note = (html === "<br>" || html === "") ? null : html;
          setUnsavedChanges(state, true);
          postHost("dirty");
          scheduleMarkdownNoteWrite(state, state.selectedNode);
        }
      });
      editor.addEventListener("blur", () => {
        if (state.selectedNode) {
          const node = state.selectedNode;
          const cleanHtml = sanitizeNoteHtml(editor.innerHTML);
          node.note = (cleanHtml === "<br>" || cleanHtml === "") ? null : cleanHtml;
          if (editor.innerHTML !== cleanHtml) editor.innerHTML = cleanHtml;
          saveToHistory(state);
          if (state.noteSyncTimer !== null) {
            window.clearTimeout(state.noteSyncTimer);
            state.noteSyncTimer = null;
          }
          if (IS_OBSIDIAN && node.noteFilePath) {
            void writeMarkdownNoteForNode(state, node, noteHtmlToMarkdown(cleanHtml)).then(() => {
              if (state.selectedNode === node) setNoteStatus(`Saved to ${node.noteFilePath}`);
            }).catch((error) => {
              if (state.selectedNode === node) setNoteStatus("Markdown save failed: " + (error && error.message ? error.message : String(error)));
            });
          }
        }
      });
    }

    const openBtn = document.getElementById("noteOpenFileBtn");
    if (openBtn) openBtn.addEventListener("click", () => void openLinkedMarkdownNote(state));

    const toolbar = document.querySelector(".note-toolbar");
    if (toolbar) {
      toolbar.addEventListener("mousedown", (e) => {
        const btn = e.target.closest("[data-cmd]");
        if (!btn) return;
        e.preventDefault();
        const cmd = btn.dataset.cmd;
        const val = btn.dataset.val || null;
        document.execCommand(cmd, false, val);
        if (editor) {
          editor.focus();
          const event = new Event("input", { bubbles: true });
          editor.dispatchEvent(event);
        }
      });
    }
  }

  function setupTagPanel(state) {
    const closeBtn = document.getElementById("tagPanelClose");
    const input = document.getElementById("tagInput");
    if (closeBtn) closeBtn.addEventListener("click", () => closeTagPanel(state));
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          const tag = input.value.trim().toLowerCase().replace(/[,#]/g, "");
          if (tag && state.selectedNode) {
            if (!state.selectedNode.tags) state.selectedNode.tags = [];
            if (!state.selectedNode.tags.includes(tag)) {
              state.selectedNode.tags.push(tag);
              renderTagChips(state);
              requestDraw(state);
              saveToHistory(state);
            }
            input.value = "";
          }
        }
        if (e.key === "Escape") closeTagPanel(state);
      });
    }
    document.addEventListener("keydown", (ev) => {
      const tag2 = ev.target && ev.target.tagName ? ev.target.tagName.toLowerCase() : "";
      const typing = tag2 === "input" || tag2 === "textarea" || ev.target.isContentEditable;
      if (!typing && ev.key === "t") { ev.preventDefault(); toggleTagPanel(state); }
    });
    document.addEventListener("click", (ev) => {
      const panel = document.getElementById("tagPanel");
      if (panel && panel.classList.contains("visible")) {
        if (!panel.contains(ev.target) && !state.tagBtn.contains(ev.target)) closeTagPanel(state);
      }
    });
  }

  // ── search ─────────────────────────────────────────────────────────────────

  function setupSearch(state) {
    const searchInput = document.getElementById("searchInput");
    const searchClear = document.getElementById("searchClear");
    const searchResults = document.getElementById("searchResults");

    function escapeHtml(s) {
      return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function getNodePath(node) {
      const parts = [];
      let current = node.parent;
      while (current) {
        parts.unshift(current.text);
        current = current.parent;
      }
      return parts;
    }

    function navigateToResult(id) {
      const node = state.nodes.find((n) => n.id === id);
      if (!node) return;
      state.selectedNode = node;
      updateDeleteButton(state);
      centerMindmap(state, () => requestDraw(state));
    }

    function renderResults(matches, partMatches, query) {
      const hasNodes = matches.length > 0;
      const hasParts = partMatches.length > 0;

      if (!hasNodes && !hasParts) {
        searchResults.innerHTML = `<div class="search-empty">No results for "${escapeHtml(query)}"</div>`;
        searchResults.classList.add("visible");
        return;
      }

      const totalCount = matches.length + partMatches.length;
      let html = `<div class="search-count">${totalCount} result${totalCount !== 1 ? "s" : ""}</div>`;

      if (hasNodes) {
        html += matches.map((n) => {
          const nodePath = getNodePath(n);
          const badge = n.resolvedFromPart
            ? `<span class="search-badge search-badge-resolved">linked</span>`
            : n.linkedPartId
              ? `<span class="search-badge search-badge-ref">ref</span>`
              : "";
          const pathHtml =
            nodePath.length > 0
              ? `<span class="search-path">${nodePath.map(escapeHtml).join(" › ")}</span>`
              : "";
          const label = n.numbering ? `${n.numbering} ${n.text}` : n.text;
          return `<div class="search-result-item" data-id="${n.id}" role="option" tabindex="0">
            <span class="search-text">${escapeHtml(label)}</span>${badge}
            ${pathHtml}
          </div>`;
        }).join("");
      }

      if (hasParts) {
        html += `<div class="search-section-label">Global Parts</div>`;
        html += partMatches.map((part) => {
          const sourceNode = state.nodes.find((n) => n.isGlobalPartSource === part.id);
          const hint = sourceNode
            ? `<span class="search-path">Source on canvas</span>`
            : `<span class="search-path">Not on canvas — insert a reference</span>`;
          return `<div class="search-result-item search-result-part" data-part-id="${escapeHtml(part.id)}" role="option" tabindex="0">
            <span class="search-text">${escapeHtml(part.name)}</span><span class="search-badge search-badge-part">part</span>
            ${hint}
          </div>`;
        }).join("");
      }

      searchResults.innerHTML = html;
      searchResults.classList.add("visible");

      searchResults.querySelectorAll(".search-result-item:not(.search-result-part)").forEach((el) => {
        const id = parseInt(el.dataset.id, 10);
        const handler = () => navigateToResult(id);
        el.addEventListener("click", handler);
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); }
        });
      });

      searchResults.querySelectorAll(".search-result-part").forEach((el) => {
        const partId = el.dataset.partId;
        const handler = () => {
          const sourceNode = state.nodes.find((n) => n.isGlobalPartSource === partId);
          if (sourceNode) {
            navigateToResult(sourceNode.id);
          } else {
            showStatus(state, "Source not on canvas — select a node and use Insert Ref from the Parts panel.");
          }
          searchResults.classList.remove("visible");
        };
        el.addEventListener("click", handler);
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); }
        });
      });
    }

    function doSearch(query) {
      const q = query.trim().toLowerCase();
      state.searchMatchIds.clear();

      if (!q) {
        searchResults.innerHTML = "";
        searchResults.classList.remove("visible");
        setElementDisplay(searchClear, "none");
        requestDraw(state);
        return;
      }

      setElementDisplay(searchClear, "flex");

      // Search canvas nodes (includes resolvedFromPart children already in state.nodes)
      // Tag filter: #tag syntax
      let matches;
      if (q.startsWith("#")) {
        const tagQuery = q.slice(1);
        matches = tagQuery ? state.nodes.filter((n) => (n.tags || []).some((t) => t.includes(tagQuery))) : [];
      } else {
        matches = state.nodes.filter((n) => n.text.toLowerCase().includes(q));
      }
      matches.forEach((n) => state.searchMatchIds.add(n.id));

      // Also search the Global Parts registry by part name
      const allParts = loadGlobalParts();
      const partMatches = q.startsWith("#")
        ? Object.values(allParts).filter((p) => (p.tags || []).some((t) => t.includes(q.slice(1))))
        : Object.values(allParts).filter((p) => p.name.toLowerCase().includes(q));

      requestDraw(state);
      renderResults(matches, partMatches, query);
    }

    searchInput.addEventListener("input", (e) => doSearch(e.target.value));

    searchInput.addEventListener("focus", () => {
      if (searchInput.value.trim()) {
        searchResults.classList.add("visible");
      }
    });

    searchClear.addEventListener("click", () => {
      searchInput.value = "";
      doSearch("");
      searchInput.focus();
    });

    document.addEventListener("click", (e) => {
      const bar = document.getElementById("searchBar");
      if (!bar.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.classList.remove("visible");
      }
    });

    document.addEventListener("keydown", (e) => {
      const targetTag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      const typing = targetTag === "input" || targetTag === "textarea" || e.target.isContentEditable;
      if (!typing && e.key === "/") {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
        return;
      }
      if (e.key === "Escape" && document.activeElement === searchInput) {
        searchInput.value = "";
        doSearch("");
        searchInput.blur();
      }
    });
  }

  function setupLevelFilter(state) {
    const select = state.levelFilterSelect || document.getElementById("levelFilterSelect");
    if (!select) return;
    updateLevelFilterControl(state);
    select.addEventListener("change", () => {
      const value = select.value;
      state.maxVisibleLevel = value === "all" ? null : Math.max(1, Number.parseInt(value, 10) || 1);
      autoLayout(state);
      calculateInsertionZones(state);
      requestDraw(state);
      setUnsavedChanges(state, true);
      postHost("dirty");
      showStatus(state, state.maxVisibleLevel == null ? "Showing all mindmap levels" : `Showing levels 1–${state.maxVisibleLevel}`);
    });
  }

  // ── main ───────────────────────────────────────────────────────────────────

  function init() {
    const state = createAppState();
    setCanvasSize(state);
    window.addEventListener("beforeunload", (e) => {
      if (IS_OBSIDIAN) return;
      if (state.hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    setupAIControls(state);
    bindControls(state);
    setupToolbar(state);
    setupKeyboardShortcuts(state);
    setupSearch(state);
    setupLevelFilter(state);
    setupGlobalPartsPanel(state);
    setupMapsPanel(state);
    setupTagPanel(state);
    setupRelPanel(state);
    setupNotePanel(state);
    setupCanvasEvents(state);
    initializeFromQuery(state);
    updateDeleteButton(state);
    requestDraw(state);

    // Cross-tab sync: when another page updates global parts or the map registry,
    // refresh this page's resolved nodes and maps list.
    window.addEventListener("storage", (e) => {
      if (e.key === GLOBAL_PARTS_KEY) {
        autoLayout(state);
        reinflateAttachments(state);
        requestDraw(state);
      }
      if (e.key === MAP_REGISTRY_KEY) {
        renderMapsList(state);
      }
    });

    if (IS_OBSIDIAN) {
      window.__PKM_APP_STATE__ = state;
      window.addEventListener("message", (event) => {
        const msg = event.data;
        if (!msg || msg.source !== "obsidian-pkm-host") return;
        if (handleAIHostMessage(state, msg)) return;
        if (msg.type === "prompt-response") {
          const pending = _hostPromptRequests.get(msg.requestId);
          if (pending) {
            window.clearTimeout(pending.timer);
            _hostPromptRequests.delete(msg.requestId);
            pending.resolve(typeof msg.value === "string" ? msg.value : null);
          }
          return;
        }
        if (msg.type === "confirm-response") {
          const pending = _hostConfirmRequests.get(msg.requestId);
          if (pending) {
            window.clearTimeout(pending.timer);
            _hostConfirmRequests.delete(msg.requestId);
            pending.resolve(msg.value === true);
          }
          return;
        }
        if (msg.type === "note-file-response") {
          const pending = _hostNoteRequests.get(msg.requestId);
          if (pending) {
            window.clearTimeout(pending.timer);
            _hostNoteRequests.delete(msg.requestId);
            pending.resolve(msg);
          }
          return;
        }
        if (msg.type === "note-file-renamed") {
          let changed = false;
          for (const node of state.nodes) {
            if (node.noteFilePath === msg.oldPath) {
              node.noteFilePath = msg.newPath;
              changed = true;
            }
          }
          if (changed) {
            setUnsavedChanges(state, true);
            postHost("dirty");
            if (state.selectedNode && state.selectedNode.noteFilePath === msg.newPath) void renderNotePanelForNode(state, state.selectedNode);
          }
          return;
        }
        if (msg.type === "note-file-deleted") {
          if (state.selectedNode && state.selectedNode.noteFilePath === msg.path) {
            setNoteStatus("Linked Markdown file was deleted. It will be recreated from the WMM note when edited or reopened.");
          }
          return;
        }
        if (msg.type === "export-request") {
          postHost("export-response", {
            requestId: msg.requestId,
            data: mindmapToJson(state, false)
          });
          return;
        }
        if (msg.type === "wmm-export-request") {
          void (async () => {
            try {
              const wmm = await buildWmmPackage(state);
              postHost("wmm-export-response", {
                requestId: msg.requestId,
                data: wmm.data,
                title: wmm.title
              }, [wmm.data]);
            } catch (error) {
              const message = "Could not build WMM file: " + (error && error.message ? error.message : String(error));
              postHost("wmm-export-error", { requestId: msg.requestId, message });
              postHost("error", { message });
            }
          })();
          return;
        }
        if (msg.type === "import-file-binary") {
          void (async () => {
            try {
              let data = msg.data;
              if (ArrayBuffer.isView(data)) data = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
              if (!(data instanceof ArrayBuffer)) throw new Error("The imported mind-map file did not contain binary data");
              const filename = String(msg.filename || "imported-mindmap");
              const result = await importMindmapArrayBuffer(filename, data);
              finishImportedDocument(state, filename, result);
            } catch (error) {
              postHost("error", { message: "Could not import mind-map file: " + (error && error.message ? error.message : String(error)) });
              postHost("import-failed", { message: error && error.message ? error.message : String(error) });
            }
          })();
          return;
        }
        if (msg.type === "import-wmm-binary") {
          void (async () => {
            try {
              let data = msg.data;
              if (ArrayBuffer.isView(data)) data = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
              if (!(data instanceof ArrayBuffer)) throw new Error("The imported .wmm file did not contain binary data");
              const json = await loadWmmFile(data);
              jsonToMindmap(state, json);
              persistDocumentAttachmentData(state);
              reinflateAttachments(state);
              updateDeleteButton(state);
              updatePartButtons(state);
              renderMapsList(state);
              const active = getActiveMap(state);
              const nativeOpen = !!msg.nativeOpen;
              setUnsavedChanges(state, !nativeOpen);
              if (!nativeOpen) postHost("dirty");
              postHost("title-changed", { title: active ? active.name : "PKM Mindmap" });
              postHost("import-complete", { nativeWmm: nativeOpen });
              showStatus(state, nativeOpen ? `Opened WMM: ${msg.filename || "mindmap.wmm"}` : `Imported WMM: ${msg.filename || "mindmap.wmm"}`);
            } catch (error) {
              const message = error && error.message ? error.message : String(error);
              postHost("error", { message: "Could not open WMM file: " + message });
              postHost("import-failed", { message });
            }
          })();
          return;
        }
        if (msg.type === "import-data") {
          try {
            let importedData = msg.data || {};
            // Vault .json files can be either native PKM JSON or raw
            // MindMeister JSON. Convert MindMeister JSON before loading it.
            if (importedData && importedData.map_version && importedData.root && importedData.root.title !== undefined) {
              importedData = importMindMeister(importedData);
            }
            jsonToMindmap(state, importedData);
            reinflateAttachments(state);
            updateDeleteButton(state);
            updatePartButtons(state);
            renderMapsList(state);
            const active = getActiveMap(state);
            postHost("title-changed", { title: active ? active.name : "PKM Mindmap" });
            postHost("import-complete");
          } catch (error) {
            postHost("error", { message: error && error.message ? error.message : String(error) });
          }
          return;
        }
        if (msg.type === "new-document") {
          const mapName = (msg.name || "My Mindmap").trim() || "My Mindmap";
          jsonToMindmap(state, {
            format: "pkm-mindmap", version: 1,
            maps: [{ id: "map_" + Date.now(), name: mapName, nodes: [{ id: 1, text: mapName, children: [] }] }],
            activeMapId: null, layoutMode: "horizontal", branchTheme: "Calm", maxVisibleLevel: null,
            viewScale: 1, viewOffsetX: 0, viewOffsetY: 0
          });
          state.activeMapId = state.maps[0] ? state.maps[0].id : null;
          setUnsavedChanges(state, false);
          renderMapsList(state);
          postHost("title-changed", { title: mapName });
          return;
        }
        if (msg.type === "mark-saved") {
          setUnsavedChanges(state, false);
          return;
        }
        if (msg.type === "set-global-parts") {
          _obsidianGlobalParts = cloneJson(msg.parts || {});
          autoLayout(state);
          reinflateAttachments(state);
          requestDraw(state);
          renderPartsList(state);
        }
      });
      postHost("ready", { title: (getActiveMap(state) && getActiveMap(state).name) || "PKM Mindmap" });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
