// content.js
(function() {
  if (window.contentCriticInitialized) return;
  window.contentCriticInitialized = true;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.type = 'text/css';
  link.href = chrome.runtime.getURL('content.css');
  document.head.appendChild(link);

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

  function createTooltip(text, type, explanation, suggestion) {
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

  function createHighlightBox(rect, type, tooltip) {
    const box = document.createElement('div');
    box.className = `content-critic-highlight-box ${type}`;
    box.style.position = 'absolute';
    box.style.left = `${rect.left + window.scrollX}px`;
    box.style.top = `${rect.top + window.scrollY}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.style.zIndex = '2147483646';

    let hoverTimeout;
    box.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
      const boxRect = box.getBoundingClientRect();
      positionTooltip(tooltip, boxRect);
      tooltip.style.display = 'block';
      requestAnimationFrame(() => {
        tooltip.classList.add('visible');
      });
    });

    box.addEventListener('mouseleave', () => {
      hoverTimeout = setTimeout(() => {
        tooltip.classList.remove('visible');
        tooltip.addEventListener('transitionend', () => {
          if (!tooltip.classList.contains('visible')) {
            tooltip.style.display = 'none';
          }
        }, { once: true });
      }, 100);
    });

    tooltip.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
      tooltip.classList.add('visible');
    });

    tooltip.addEventListener('mouseleave', () => {
      hoverTimeout = setTimeout(() => {
        tooltip.classList.remove('visible');
        tooltip.addEventListener('transitionend', () => {
          if (!tooltip.classList.contains('visible')) {
            tooltip.style.display = 'none';
          }
        }, { once: true });
      }, 100);
    });

    return box;
  }

  function updateHighlightPositions() {
    const container = document.getElementById('content-critic-highlights');
    if (!container) return;

    const boxes = container.querySelectorAll('.content-critic-highlight-box');
    boxes.forEach(box => {
      const text = box.getAttribute('data-highlight-text');
      if (!text) return;

      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function(node) {
            if (!node.parentElement ||
                node.parentElement.closest('script, style, noscript, .content-critic-highlight-box')) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        },
        false
      );

      let node;
      let found = false;
      while (node = walker.nextNode()) {
        const nodeText = normalizeText(node.textContent);
        if (nodeText.includes(normalizeText(text))) {
          const startIndex = nodeText.indexOf(normalizeText(text));
          const endIndex = startIndex + normalizeText(text).length;

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

      if (!found) {
        box.style.display = 'none';
      } else {
        box.style.display = 'block';
      }
    });
  }

  function normalizeText(text) {
    if (!text) return '';
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  function highlightText(text, type, explanation, suggestion) {
    const tooltip = createTooltip(text, type, explanation, suggestion);
    const normalizedSearchText = normalizeText(text);

    if (!normalizedSearchText) return;

    let highlightContainer = document.getElementById('content-critic-highlights');
    if (!highlightContainer) {
      highlightContainer = document.createElement('div');
      highlightContainer.id = 'content-critic-highlights';
      highlightContainer.style.position = 'absolute';
      highlightContainer.style.top = '0';
      highlightContainer.style.left = '0';
      highlightContainer.style.width = '100%';
      highlightContainer.style.height = '100%';
      highlightContainer.style.pointerEvents = 'none';
      highlightContainer.style.zIndex = '2147483646';
      document.body.appendChild(highlightContainer);

      const resizeObserver = new ResizeObserver(() => {
        updateHighlightPositions();
      });

      resizeObserver.observe(document.body);
      document.querySelectorAll('main, article, .content, #content, [role="main"]').forEach(el => {
        resizeObserver.observe(el);
      });

      highlightContainer._resizeObserver = resizeObserver;
    }

    const walker = document.createTreeWalker(
      document.body,
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

    let node;
    while (node = walker.nextNode()) {
      const nodeText = node.textContent;
      const normalizedNodeText = normalizeText(nodeText);

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
          highlightContainer.appendChild(box);
        });
      }
    }

    window.addEventListener('scroll', updateHighlightPositions);
  }

  function removeHighlights() {
    const container = document.getElementById('content-critic-highlights');
    if (container) {
      if (container._resizeObserver) {
        container._resizeObserver.disconnect();
      }
      container.remove();
    }
    document.querySelectorAll('.content-critic-tooltip').forEach(el => el.remove());
    window.removeEventListener('scroll', updateHighlightPositions);
  }

  function extractContent() {
    const content = document.body.innerText;
    const title = document.title;
    const url = window.location.href;
    return { content, title, url };
  }

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
        request.highlights.forEach(h => {
          highlightText(h.text, h.type, h.explanation, h.suggestion);
        });
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
