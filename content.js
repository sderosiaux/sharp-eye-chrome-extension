// content.js
(function() {
  // Check if we're already initialized
  if (window.contentCriticInitialized) {
    return;
  }
  window.contentCriticInitialized = true;

  // Dynamically link the CSS file
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.type = 'text/css';
  link.href = chrome.runtime.getURL('content.css');
  document.head.appendChild(link);

  // Function to position tooltip
  function positionTooltip(tooltip, highlightRect) {
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Default position (below the highlight)
    let top = highlightRect.bottom + 5;
    let left = highlightRect.left;
    
    // If tooltip would go below viewport, position it above
    if (top + tooltipRect.height > viewportHeight) {
      top = highlightRect.top - tooltipRect.height - 5;
    }
    
    // If tooltip would go beyond right edge, align with right edge of highlight
    if (left + tooltipRect.width > viewportWidth) {
      left = highlightRect.right - tooltipRect.width;
    }
    
    // Ensure tooltip stays within viewport
    top = Math.max(5, Math.min(top, viewportHeight - tooltipRect.height - 5));
    left = Math.max(5, Math.min(left, viewportWidth - tooltipRect.width - 5));
    
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  // Function to create a tooltip
  function createTooltip(text, type, explanation, suggestion) {
    const tooltip = document.createElement('div');
    tooltip.className = 'content-critic-tooltip';
    tooltip.style.display = 'none';

    // Type badge
    const typeBadge = document.createElement('div');
    typeBadge.className = `content-critic-type ${type}`;
    typeBadge.textContent = type.charAt(0).toUpperCase() + type.slice(1);

    // Explanation
    const explanationText = document.createElement('div');
    explanationText.className = 'content-critic-explanation';
    explanationText.textContent = explanation;

    tooltip.appendChild(typeBadge);
    tooltip.appendChild(explanationText);

    // Show suggestion if provided
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

  // Function to create a highlight box
  function createHighlightBox(rect, type, tooltip) {
    const box = document.createElement('div');
    box.className = `content-critic-highlight-box ${type}`;
    box.style.position = 'absolute';
    box.style.left = `${rect.left + window.scrollX}px`;
    box.style.top = `${rect.top + window.scrollY}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.style.zIndex = '2147483646';

    // Add hover effect with a small delay to prevent flickering
    let hoverTimeout;
    box.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
      const boxRect = box.getBoundingClientRect();
      
      // Position the tooltip
      positionTooltip(tooltip, boxRect);
      
      // Show tooltip and trigger fade in
      tooltip.style.display = 'block';
      requestAnimationFrame(() => {
        tooltip.classList.add('visible');
      });
    });

    box.addEventListener('mouseleave', () => {
      hoverTimeout = setTimeout(() => {
        tooltip.classList.remove('visible');
        // Hide tooltip after fade out
        tooltip.addEventListener('transitionend', () => {
          if (!tooltip.classList.contains('visible')) {
            tooltip.style.display = 'none';
          }
        }, { once: true });
      }, 100);
    });

    // Also handle tooltip hover
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

  // Function to get text node rectangles
  function getTextNodeRects(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects());
    return rects;
  }

  // Function to update highlight positions
  function updateHighlightPositions() {
    const container = document.getElementById('content-critic-highlights');
    if (!container) return;
    
    const boxes = container.querySelectorAll('.content-critic-highlight-box');
    boxes.forEach(box => {
      // Find the original text node that this highlight corresponds to
      const text = box.getAttribute('data-highlight-text');
      if (!text) return;

      // Find all text nodes that might contain this text
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
          // Create a range for the specific text
          const startIndex = nodeText.indexOf(normalizeText(text));
          const endIndex = startIndex + normalizeText(text).length;
          
          const range = document.createRange();
          range.setStart(node, startIndex);
          range.setEnd(node, endIndex);
          
          // Get the new rectangles for this range
          const rects = Array.from(range.getClientRects());
          if (rects.length > 0) {
            // Update the highlight box position
            const rect = rects[0]; // Use the first rectangle
            box.style.left = `${rect.left + window.scrollX}px`;
            box.style.top = `${rect.top + window.scrollY}px`;
            box.style.width = `${rect.width}px`;
            box.style.height = `${rect.height}px`;
            found = true;
            break;
          }
        }
      }

      // If we couldn't find the text anymore, hide the highlight
      if (!found) {
        box.style.display = 'none';
      } else {
        box.style.display = 'block';
      }
    });
  }

  // Function to normalize text for comparison
  function normalizeText(text) {
    if (!text) return '';
    
    // Remove HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    
    // Remove HTML tags but keep their content
    text = text.replace(/<[^>]+>/g, ' ');
    
    // Normalize whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    return text;
  }

  // Function to highlight text using absolute positioned boxes
  function highlightText(text, type, explanation, suggestion) {
    console.log('Highlighting text:', {
      text: text.substring(0, 50) + '...',
      type,
      explanation,
      suggestion
    });

    const tooltip = createTooltip(text, type, explanation, suggestion);
    let highlightCount = 0;
    const normalizedSearchText = normalizeText(text);

    if (!normalizedSearchText) {
      console.warn("Normalized search text is empty, skipping highlighting. Original text:", text);
      return;
    }

    // Create a container for all highlight boxes if it doesn't exist
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

      // Set up ResizeObserver to watch for content changes
      const resizeObserver = new ResizeObserver(() => {
        updateHighlightPositions();
      });

      // Observe the body and any dynamic content containers
      resizeObserver.observe(document.body);
      document.querySelectorAll('main, article, .content, #content, [role="main"]').forEach(el => {
        resizeObserver.observe(el);
      });

      // Store the observer for cleanup
      highlightContainer._resizeObserver = resizeObserver;
    }

    // Process each text node
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
          // Store the original text for later repositioning
          box.setAttribute('data-highlight-text', text);
          highlightContainer.appendChild(box);
          highlightCount++;
        });
      }
    }

    // Add scroll listener to update box positions
    window.addEventListener('scroll', updateHighlightPositions);

    console.log(`Highlighting complete:`, {
      text: text.substring(0, 50) + '...',
      highlightsAdded: highlightCount,
      highlightType: type
    });

    if (highlightCount === 0) {
      console.info('No highlights were added. This might indicate a problem with text matching or DOM structure for:', normalizedSearchText);
    }
  }

  // Function to remove all highlights
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

  // Extract page content
  function extractContent() {
    const content = document.body.innerText;
    const title = document.title;
    const url = window.location.href;

    console.log('Sharp Eye: Content extracted', {
      title,
      contentLength: content.length
    });

    return { content, title, url };
  }

  // Message handlers
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Sharp Eye: Message received:', request.action);

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

      case 'getSelectedText':
        const selection = window.getSelection();
        sendResponse({ selectedText: selection.toString().trim() });
        break;
    }

    return true;
  });

  console.log('Sharp Eye: Content script initialized');
})();