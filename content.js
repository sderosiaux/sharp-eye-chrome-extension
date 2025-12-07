// content.js
(function() {
  if (window.contentCriticInitialized) return;
  window.contentCriticInitialized = true;

  // ============================================
  // Setup
  // ============================================

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.type = 'text/css';
  link.href = chrome.runtime.getURL('content.css');
  document.head.appendChild(link);

  // ============================================
  // Utility Functions
  // ============================================

  function normalizeText(text) {
    if (!text) return '';
    return text
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function createTextWalker(root = document.body) {
    return document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          if (!node.parentElement ||
              node.parentElement.closest('script, style, noscript, .content-critic-highlight-box')) {
            return NodeFilter.FILTER_REJECT;
          }
          if (!node.textContent || normalizeText(node.textContent).length === 0) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      },
      false
    );
  }

  // ============================================
  // Tooltip Functions
  // ============================================

  function positionTooltip(tooltip, highlightRect) {
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = highlightRect.bottom + 5;
    let left = highlightRect.left;

    if (top + tooltipRect.height > viewportHeight) {
      top = highlightRect.top - tooltipRect.height - 5;
    }

    if (left + tooltipRect.width > viewportWidth) {
      left = highlightRect.right - tooltipRect.width;
    }

    top = Math.max(5, Math.min(top, viewportHeight - tooltipRect.height - 5));
    left = Math.max(5, Math.min(left, viewportWidth - tooltipRect.width - 5));

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  function createTooltip(highlight) {
    const { type, explanation, suggestion } = highlight;

    const tooltip = document.createElement('div');
    tooltip.className = 'content-critic-tooltip';
    tooltip.style.display = 'none';

    const typeBadge = document.createElement('div');
    typeBadge.className = `content-critic-type ${type}`;
    typeBadge.textContent = type.charAt(0).toUpperCase() + type.slice(1);

    const explanationText = document.createElement('div');
    explanationText.className = 'content-critic-explanation';
    explanationText.textContent = explanation;

    tooltip.appendChild(typeBadge);
    tooltip.appendChild(explanationText);

    if (suggestion) {
      const suggestionContainer = document.createElement('div');
      suggestionContainer.className = 'content-critic-suggestion';

      const suggestionLabel = document.createElement('div');
      suggestionLabel.className = 'content-critic-suggestion-label';
      suggestionLabel.textContent = 'Suggestion';

      const suggestionText = document.createElement('div');
      suggestionText.className = 'content-critic-suggestion-text';
      suggestionText.textContent = suggestion;

      suggestionContainer.appendChild(suggestionLabel);
      suggestionContainer.appendChild(suggestionText);
      tooltip.appendChild(suggestionContainer);
    }

    document.body.appendChild(tooltip);
    return tooltip;
  }

  // ============================================
  // Hover Behavior
  // ============================================

  function setupHoverBehavior(element, tooltip) {
    let hoverTimeout;

    function showTooltip(rect) {
      clearTimeout(hoverTimeout);
      positionTooltip(tooltip, rect);
      tooltip.style.display = 'block';
      requestAnimationFrame(() => tooltip.classList.add('visible'));
    }

    function hideTooltip() {
      hoverTimeout = setTimeout(() => {
        tooltip.classList.remove('visible');
        tooltip.addEventListener('transitionend', () => {
          if (!tooltip.classList.contains('visible')) {
            tooltip.style.display = 'none';
          }
        }, { once: true });
      }, 100);
    }

    element.addEventListener('mouseenter', () => {
      showTooltip(element.getBoundingClientRect());
    });

    element.addEventListener('mouseleave', hideTooltip);

    tooltip.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
      tooltip.classList.add('visible');
    });

    tooltip.addEventListener('mouseleave', hideTooltip);
  }

  // ============================================
  // Highlight Box Functions
  // ============================================

  function createHighlightBox(rect, type, tooltip) {
    const box = document.createElement('div');
    box.className = `content-critic-highlight-box ${type}`;
    box.style.position = 'absolute';
    box.style.left = `${rect.left + window.scrollX}px`;
    box.style.top = `${rect.top + window.scrollY}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.style.zIndex = '2147483646';

    setupHoverBehavior(box, tooltip);

    return box;
  }

  function updateHighlightPositions() {
    const container = document.getElementById('content-critic-highlights');
    if (!container) return;

    const boxes = container.querySelectorAll('.content-critic-highlight-box');
    boxes.forEach(box => {
      const text = box.getAttribute('data-highlight-text');
      if (!text) return;

      const walker = createTextWalker();
      const normalizedSearch = normalizeText(text);

      let node;
      let found = false;

      while (node = walker.nextNode()) {
        const nodeText = normalizeText(node.textContent);
        if (nodeText.includes(normalizedSearch)) {
          const startIndex = nodeText.indexOf(normalizedSearch);
          const endIndex = startIndex + normalizedSearch.length;

          const range = document.createRange();
          range.setStart(node, startIndex);
          range.setEnd(node, endIndex);

          const rects = Array.from(range.getClientRects());
          if (rects.length > 0) {
            const rect = rects[0];
            box.style.left = `${rect.left + window.scrollX}px`;
            box.style.top = `${rect.top + window.scrollY}px`;
            box.style.width = `${rect.width}px`;
            box.style.height = `${rect.height}px`;
            found = true;
            break;
          }
        }
      }

      box.style.display = found ? 'block' : 'none';
    });
  }

  // ============================================
  // Highlight Container
  // ============================================

  function getOrCreateHighlightContainer() {
    let container = document.getElementById('content-critic-highlights');

    if (!container) {
      container = document.createElement('div');
      container.id = 'content-critic-highlights';
      container.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 2147483646;
      `;
      document.body.appendChild(container);

      const resizeObserver = new ResizeObserver(updateHighlightPositions);
      resizeObserver.observe(document.body);

      document.querySelectorAll('main, article, .content, #content, [role="main"]').forEach(el => {
        resizeObserver.observe(el);
      });

      container._resizeObserver = resizeObserver;

      window.addEventListener('scroll', updateHighlightPositions);
    }

    return container;
  }

  // ============================================
  // Main Highlight Function
  // ============================================

  function highlightText(highlight) {
    const { text, type, explanation, suggestion } = highlight;
    const normalizedSearchText = normalizeText(text);

    if (!normalizedSearchText) return;

    const tooltip = createTooltip(highlight);
    const container = getOrCreateHighlightContainer();
    const walker = createTextWalker();

    let node;
    while (node = walker.nextNode()) {
      const normalizedNodeText = normalizeText(node.textContent);

      if (normalizedNodeText.includes(normalizedSearchText)) {
        const startIndex = normalizedNodeText.indexOf(normalizedSearchText);
        const endIndex = startIndex + normalizedSearchText.length;

        const range = document.createRange();
        range.setStart(node, startIndex);
        range.setEnd(node, endIndex);

        const rects = Array.from(range.getClientRects());

        rects.forEach(rect => {
          const box = createHighlightBox(rect, type, tooltip);
          box.setAttribute('data-highlight-text', text);
          container.appendChild(box);
        });
      }
    }
  }

  // ============================================
  // Cleanup
  // ============================================

  function removeHighlights() {
    const container = document.getElementById('content-critic-highlights');
    if (container) {
      container._resizeObserver?.disconnect();
      container.remove();
    }
    document.querySelectorAll('.content-critic-tooltip').forEach(el => el.remove());
    window.removeEventListener('scroll', updateHighlightPositions);
  }

  // ============================================
  // Content Extraction
  // ============================================

  function extractContent() {
    return {
      content: document.body.innerText,
      title: document.title,
      url: window.location.href
    };
  }

  // ============================================
  // Message Handler
  // ============================================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'ping':
        sendResponse({ status: 'ready' });
        break;

      case 'getContent':
        sendResponse(extractContent());
        break;

      case 'highlightContent':
        removeHighlights();
        request.highlights.forEach(highlightText);
        sendResponse({ success: true });
        break;

      case 'clearHighlights':
        removeHighlights();
        sendResponse({ success: true });
        break;
    }

    return true;
  });
})();
