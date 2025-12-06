// sidepanel.js
import { CriticPrompt } from './prompts.js';
import { createApiClient } from './api_client.js';

let currentTabId = null;
let isAnalyzing = false;

// Raw content handling
let currentRawContent = null;

// Raw response handling
let currentRawResponse = null;

// Sauvegarde la clé API
function saveApiKey() {
  const apiKey = document.getElementById('apiKey').value;
  chrome.storage.local.set({ apiKey });
}

// Function to filter out our highlights from content
function filterHighlights(content) {
  if (!content) return '';
  
  // Remove any text that matches our highlight patterns
  const highlightPatterns = [
    // Match highlight annotations (type in all caps, followed by colon)
    /^(?:ASSUMPTION|FALLACY|CONTRADICTION|INCONSISTENCY|FLUFF):\s*[^\n]*(?:\n(?!\n)[^\n]*)*/gim
  ];
  
  let cleanContent = content;
  let totalRemoved = 0;
  
  highlightPatterns.forEach((pattern, index) => {
    const beforeLength = cleanContent.length;
    const matches = cleanContent.match(pattern) || [];
    
    if (matches.length > 0) {
      console.log(`Removed ${matches.length} highlight annotations`);
    }
    
    cleanContent = cleanContent.replace(pattern, (match) => {
      totalRemoved += match.length;
      return '';
    });
  });
  
  // Clean up any extra whitespace created by the removal
  cleanContent = cleanContent
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Replace multiple newlines with double newlines
    .replace(/^\s+|\s+$/g, ''); // Trim whitespace
  
  if (totalRemoved > 0) {
    console.log('Content filtering:', {
      initialLength: content.length,
      finalLength: cleanContent.length,
      removed: totalRemoved
    });
  }
  
  return cleanContent;
}

// Helper function to set loading state
function setLoadingState(isLoading) {
  const resultDiv = document.getElementById('result');
  const analyzeBtn = document.getElementById('analyzeBtn');
  
  if (isLoading) {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing...';
    resultDiv.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <div>Analyzing content...</div>
      </div>`;
  } else {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze';
  }
}

// Helper function to sync UI state with tab's analysis status
async function syncUIWithTabState(urlKey) {
  const { tabResults = {} } = await chrome.storage.local.get('tabResults');
  const tabData = tabResults[urlKey];
  
  if (tabData?.isAnalyzing) {
    setLoadingState(true);
  } else {
    setLoadingState(false);
  }
}

// Helper function to get a clean URL key
function getUrlKey(url) {
  try {
    // Remove trailing slash and hash
    return url.replace(/\/$/, '').split('#')[0];
  } catch (e) {
    console.error('Error getting URL key:', e);
    return url;
  }
}

// Main API call orchestrator
async function makeApiCall(promptInstance, content, options = {}) {
  const apiKey = options.apiKey || await getApiKey();
  if (!apiKey) {
    throw new Error('No API key found');
  }

  // Create API client
  const client = createApiClient(apiKey, {
    model: promptInstance.model
  });

  try {
    // Format the prompt with content
    const formattedPrompt = promptInstance.formatWithContent(content);

    // Get JSON schema if available (for structured outputs)
    const jsonSchema = promptInstance.getJsonSchema?.();

    // Make API call with schema if available
    const rawResponse = await client.call(formattedPrompt, {
      ...options,
      jsonSchema
    });

    // Use prompt instance to parse response (this will handle validation internally)
    const parsedResponse = promptInstance.parseResponse(rawResponse);

    return { raw: rawResponse, parsed: parsedResponse };
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}

// Helper function to store analysis results
async function storeAnalysisResults(urlKey, data) {
  const { tabResults = {} } = await chrome.storage.local.get('tabResults');
  tabResults[urlKey] = {
    ...data,
    timestamp: Date.now(),
    isAnalyzing: false
  };
  await chrome.storage.local.set({ tabResults });
}

// Helper function to update analyzing state
async function updateAnalyzingState(urlKey, isAnalyzing, tabId) {
  const { tabResults = {} } = await chrome.storage.local.get('tabResults');
  tabResults[urlKey] = {
    ...tabResults[urlKey],
    isAnalyzing,
    timestamp: Date.now(),
    tabId
  };
  await chrome.storage.local.set({ tabResults });
}

// New consolidated function to execute analysis and update UI
async function _executeAnalysisAndUpdateUI(contentToAnalyze, tabInfo, apiKey) {
  const urlKey = getUrlKey(tabInfo.url);
  currentTabId = tabInfo.id;
  isAnalyzing = true;

  setLoadingState(true);
  await updateAnalyzingState(urlKey, true, tabInfo.id);

  try {
    currentRawContent = contentToAnalyze;
    
    const tokenInfo = computeTokenInfo(contentToAnalyze);
    document.getElementById('rawContentTokenInfo').textContent = tokenInfo.displayText;

    const promptInstance = new CriticPrompt();

    const { raw, parsed } = await makeApiCall(promptInstance, contentToAnalyze, {
      apiKey
    });
    currentRawResponse = raw;

    // Store results
    const storedData = {
      content: contentToAnalyze,
      title: tabInfo.title,
      url: tabInfo.url,
      tabId: tabInfo.id,
      analysis: parsed.analysis,
      highlights: parsed.highlights
    };

    // Send highlights to content script
    if (parsed.highlights?.length > 0) {
      chrome.tabs.sendMessage(tabInfo.id, {
        action: "highlightContent",
        highlights: parsed.highlights
      });
    }

    await storeAnalysisResults(urlKey, storedData);

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab.id === tabInfo.id) {
      displayResult(parsed.analysis, tabInfo.title);
    }

  } catch (error) {
    await updateAnalyzingState(urlKey, false, tabInfo.id);
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab.id === tabInfo.id) {
      displayError('Error: ' + error.message);
    }
  } finally {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab.id === tabInfo.id) {
      isAnalyzing = false;
      setLoadingState(false);
    }
  }
}

async function analyzeContent() {
  const { apiKey: storedApiKey } = await chrome.storage.local.get(['apiKey']);
  const inputApiKey = document.getElementById('apiKey').value;
  const apiKey = storedApiKey || inputApiKey;

  if (!apiKey) {
    displayError('Please enter your API key');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    displayError('Unable to find active tab or tab URL');
    return;
  }
  
  // Save the API key if it's from input and different from stored
  if (inputApiKey && inputApiKey !== storedApiKey) {
    saveApiKey();
  }

  // Show loading state immediately
  setLoadingState(true); 
  const urlKey = getUrlKey(tab.url);
  await updateAnalyzingState(urlKey, true, tab.id);

  try {
    let contentToAnalyze;
    
    // If we have currentRawContent (from selection or previous edit), use it
    if (currentRawContent) {
      contentToAnalyze = currentRawContent;
    } else {
      // Otherwise get content from the page
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout: Unable to get page content'));
        }, 5000);

        chrome.tabs.sendMessage(tab.id, { action: "getContent" }, (msgResponse) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error('Content script not ready. Please refresh the page.'));
            return;
          }
          resolve(msgResponse);
        });
      });

      if (!response || !response.content) {
        throw new Error('Unable to get page content');
      }

      contentToAnalyze = filterHighlights(response.content);
    }

    // Pass necessary tab info to the analysis function
    await _executeAnalysisAndUpdateUI(contentToAnalyze, { 
      id: tab.id, 
      url: tab.url, 
      title: tab.title 
    }, apiKey);

  } catch (error) {
    await updateAnalyzingState(getUrlKey(tab.url), false, tab.id);
    displayError('Error: ' + error.message);
    setLoadingState(false);
    isAnalyzing = false;
  }
}

function displayResult(text, title = '') {
  const resultDiv = document.getElementById('result');
  if (!resultDiv) {
    console.error('Result div not found');
    return;
  }

  try {
    let displayText;
    let htmlContent;
    console.log('Displaying result:', text);

    // Handle both string and object responses
    if (typeof text === 'string') {
      // Pre-process markdown tables to ensure they're not split
      displayText = text.replace(/\|\n\|/g, '|\n|'); // Fix split table rows
      displayText = displayText.replace(/\n\s*\n\s*\|/g, '\n|'); // Remove extra newlines before table rows
      displayText = displayText.replace(/\|\s*\n\s*\n/g, '|\n'); // Remove extra newlines after table rows
    } else if (text && typeof text === 'object') {
      // Handle both direct analysis object and full result object
      let summary = text.summary || (text.analysis && text.analysis.summary) || '';
      let critique = text.critique || (text.analysis && text.analysis.critique) || '';
      
      // Fix tables in both summary and critique
      summary = summary.replace(/\|\n\|/g, '|\n|')
                      .replace(/\n\s*\n\s*\|/g, '\n|')
                      .replace(/\|\s*\n\s*\n/g, '|\n');
      critique = critique.replace(/\|\n\|/g, '|\n|')
                        .replace(/\n\s*\n\s*\|/g, '\n|')
                        .replace(/\|\s*\n\s*\n/g, '|\n');
      
      // Just combine the content without the section titles
      displayText = `${summary}\n\n${critique}`;
    } else {
      displayText = 'Invalid analysis format';
    }

    // Convert markdown to HTML
    htmlContent = simpleMarkdown(displayText);
    
    const titleHtml = title ? `<div class="article-title">Analyzing: ${title}</div>` : '';
    resultDiv.innerHTML = `
      <div class="result">
        ${titleHtml}
        <div class="markdown-content">${htmlContent}</div>
      </div>`;
    
    // Scroll to top of result
    resultDiv.scrollTop = 0;
  } catch (error) {
    console.error('Error displaying result:', error);
    const titleHtml = title ? `<div class="article-title">Analyzing: ${title}</div>` : '';
    resultDiv.innerHTML = `
      <div class="result">
        ${titleHtml}
        <div class="markdown-content">${typeof text === 'string' ? text : JSON.stringify(text, null, 2)}</div>
      </div>`;
  }
}

function displayError(error) {
  const resultDiv = document.getElementById('result');
  resultDiv.innerHTML = `<div class="result error">${error}</div>`;
}

// Helper functions to show and hide modals
function showModal(modalElement) {
  if (modalElement) {
    modalElement.classList.add('visible');
  }
}

function hideModal(modalElement) {
  if (modalElement) {
    modalElement.classList.remove('visible');
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Initialize the extension
  initializeExtension();

  const apiKeyModal = document.getElementById('apiKeyModal');
  const rawContentModal = document.getElementById('rawContentModal');
  const rawResponseModal = document.getElementById('rawResponseModal');

  // Create header buttons container
  const headerButtonsContainer = document.createElement('div');
  headerButtonsContainer.className = 'header-buttons-container';
  headerButtonsContainer.innerHTML = `
    <button id="apiKeyBtn" class="header-button icon-only" title="API Settings">
      <span class="button-icon">⚙️</span>
    </button>
    <button id="rawContentBtn" class="header-button icon-only" title="Raw Content">
      <span class="button-icon">📄</span>
    </button>
    <button id="rawResponseBtn" class="header-button icon-only" title="Raw Response">
      <span class="button-icon">📋</span>
    </button>
    <button id="analyzeBtn" class="header-button primary" title="Analyze Content">
      <span class="button-text">Analyze</span>
    </button>
  `;

  // Replace the old buttons with the new container
  const headerRight = document.querySelector('.header-right');
  const oldButtons = headerRight.querySelectorAll('.header-button');
  oldButtons.forEach(btn => btn.remove());
  headerRight.appendChild(headerButtonsContainer);

  // Add click handlers for all buttons
  document.getElementById('analyzeBtn').addEventListener('click', analyzeContent);

  document.getElementById('apiKeyBtn').addEventListener('click', () => {
    showModal(apiKeyModal);
    // Load current API key if exists
    chrome.storage.local.get(['apiKey'], (result) => {
      if (result.apiKey) {
        document.getElementById('apiKey').value = result.apiKey;
        updateApiKeyStatus(result.apiKey);
      }
    });
  });

  document.getElementById('closeApiKeyBtn').addEventListener('click', () => {
    hideModal(apiKeyModal);
  });

  document.getElementById('saveApiKeyBtn').addEventListener('click', () => {
    saveApiKey();
    hideModal(apiKeyModal);
  });

  document.getElementById('rawContentBtn').addEventListener('click', () => {
    const textDiv = document.getElementById('rawContentText');

    if (currentRawContent) {
      const tokenInfo = document.getElementById('rawContentTokenInfo');
      tokenInfo.textContent = computeTokenInfo(currentRawContent).displayText;
      textDiv.textContent = currentRawContent;
      document.getElementById('copyContentBtn').style.display = 'block';
    } else {
      textDiv.textContent = 'No content available';
      document.getElementById('copyContentBtn').style.display = 'none';
    }
    showModal(rawContentModal);
  });

  document.getElementById('closeRawContentBtn').addEventListener('click', () => {
    hideModal(rawContentModal);
  });

  document.getElementById('rawResponseBtn').addEventListener('click', () => {
    const textDiv = document.getElementById('rawResponseText');
    
    if (currentRawResponse) {
      try {
        // Try to parse and format the JSON
        const jsonResponse = JSON.parse(currentRawResponse);
        textDiv.textContent = JSON.stringify(jsonResponse, null, 2);
      } catch (e) {
        // If it's not valid JSON, display as is
        textDiv.textContent = currentRawResponse;
      }
      const tokenInfo = document.getElementById('rawResponseTokenInfo');
      tokenInfo.textContent = computeTokenInfo(currentRawResponse).displayText;
    } else {
      textDiv.textContent = 'No raw response available. Please run an analysis first.';
    }
    showModal(rawResponseModal);
  });

  document.getElementById('closeRawResponseBtn').addEventListener('click', () => {
    hideModal(rawResponseModal);
  });

  document.getElementById('apiKey').addEventListener('input', (e) => {
    updateApiKeyStatus(e.target.value);
  });

  document.getElementById('copyContentBtn').addEventListener('click', async () => {
    if (currentRawContent) {
      try {
        await navigator.clipboard.writeText(currentRawContent);
        const copyBtn = document.getElementById('copyContentBtn');
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.classList.remove('copied');
        }, 2000);
      } catch (err) {
        console.error('Failed to copy content:', err);
      }
    }
  });

  // Close modals when clicking outside
  window.addEventListener('click', (e) => {
    if (e.target === apiKeyModal) {
      hideModal(apiKeyModal);
    }
    if (e.target === rawContentModal) {
      hideModal(rawContentModal);
    }
    if (e.target === rawResponseModal) {
      hideModal(rawResponseModal);
    }
  });
});

// API Key section handling
function updateApiKeyStatus(apiKey) {
  const statusElement = document.getElementById('apiKeyStatus');
  
  if (apiKey) {
    // Validate API key format
    const isValid = apiKey.startsWith('sk-') || apiKey.startsWith('sk-ant-');
    statusElement.textContent = isValid ? 'Configured' : 'Invalid format';
    statusElement.className = `api-key-status ${isValid ? 'valid' : ''}`;
  } else {
    statusElement.textContent = 'Not configured';
    statusElement.className = 'api-key-status';
  }
}

// Listen for tab changes and update the panel
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  console.log('Tab activated:', activeInfo);
  try {
    // Update current tab ID
    currentTabId = activeInfo.tabId;
    
    // Get the tab info
    const tab = await chrome.tabs.get(activeInfo.tabId);
    console.log('Current tab info:', tab);
    
    if (!tab.url || !tab.url.startsWith('http')) {
      console.log('Not a valid web page, clearing results');
      document.getElementById('result').innerHTML = '';
      setLoadingState(false);  // Reset UI state
      return;
    }
    
    // Sync UI state with the new tab's analysis status
    const urlKey = getUrlKey(tab.url);
    await syncUIWithTabState(urlKey);
    
    // Clear current result and load stored analysis
    document.getElementById('result').innerHTML = '';
    await loadStoredAnalysis(activeInfo.tabId);
  } catch (error) {
    console.error('Error handling tab activation:', error);
    document.getElementById('result').innerHTML = '';
    setLoadingState(false);  // Reset UI state on error
  }
});

// Also listen for tab updates (e.g., when navigating to a new page in the same tab)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only proceed if this is the current tab and the URL has changed
  if (tabId === currentTabId && changeInfo.status === 'complete') {
    console.log('Tab updated:', { tabId, changeInfo, tab });
    try {
      if (!tab.url || !tab.url.startsWith('http')) {
        console.log('Not a valid web page, clearing results');
        document.getElementById('result').innerHTML = '';
        setLoadingState(false);  // Reset UI state
        return;
      }
      
      // Sync UI state with the updated tab's analysis status
      const urlKey = getUrlKey(tab.url);
      await syncUIWithTabState(urlKey);
      
      // Clear the current result since we're on a new page
      document.getElementById('result').innerHTML = '';
      // Try to load any existing analysis for this URL
      await loadStoredAnalysis(tabId);
    } catch (error) {
      console.error('Error handling tab update:', error);
      document.getElementById('result').innerHTML = '';
      setLoadingState(false);  // Reset UI state on error
    }
  }
});

// Compute token info for content
function computeTokenInfo(content) {
  const charCount = content.length;
  const wordCount = content.trim().split(/\s+/).length;
  const estimatedTokens = Math.ceil(charCount / 4); // Rough estimate: ~4 chars per token
  return {
    charCount,
    wordCount,
    estimatedTokens,
    displayText: `≈ ${estimatedTokens.toLocaleString()} tokens (${wordCount.toLocaleString()} words, ${charCount.toLocaleString()} chars)`
  };
}

// Load stored analysis for a tab
async function loadStoredAnalysis(tabId) {
  if (!tabId) {
    console.log('No tabId provided to loadStoredAnalysis');
    return;
  }

  try {
    // Get current tab URL to check if it matches stored data
    const tab = await chrome.tabs.get(tabId);
    console.log('Loading analysis for tab:', { tabId, url: tab?.url });
    
    if (!tab || !tab.url) {
      console.log('No valid tab or URL found');
      document.getElementById('result').innerHTML = '';
      setLoadingState(false);
      return;
    }

    const urlKey = getUrlKey(tab.url);
    const storage = await chrome.storage.local.get('tabResults');
    console.log('All stored results:', storage.tabResults);
    
    if (!storage || !storage.tabResults) {
      console.log('No tabResults found in storage');
      document.getElementById('result').innerHTML = '';
      setLoadingState(false);
      return;
    }

    const tabData = storage.tabResults[urlKey];
    console.log('Found tab data:', { 
      tabId, 
      urlKey,
      currentUrl: tab.url, 
      storedUrl: tabData?.url,
      hasAnalysis: !!tabData?.analysis,
      isAnalyzing: tabData?.isAnalyzing,
      hasHighlights: !!tabData?.highlights?.length
    });
    
    // Sync UI state with the tab's analysis status
    await syncUIWithTabState(urlKey);
    
    if (tabData) {
      console.log('Displaying stored analysis for URL:', tab.url);

      displayResult(tabData.analysis, tabData.title);

      if (tabData.content) {
        currentRawContent = filterHighlights(tabData.content);
        const tokenInfo = document.getElementById('rawContentTokenInfo');
        tokenInfo.textContent = computeTokenInfo(currentRawContent).displayText;
      }

      // Restore highlights
      if (tabData.highlights?.length > 0) {
        try {
          await chrome.tabs.sendMessage(tabId, {
            action: "highlightContent",
            highlights: tabData.highlights
          });
        } catch (error) {
          console.error('Failed to restore highlights:', error);
        }
      }
    } else {
      console.log('No matching analysis found:', {
        hasTabData: !!tabData,
        hasAnalysis: !!tabData?.analysis
      });
      document.getElementById('result').innerHTML = '';
      currentRawContent = null;
      currentRawResponse = null;
    }
  } catch (error) {
    console.error('Error loading stored analysis:', error);
    document.getElementById('result').innerHTML = '';
    currentRawContent = null;
    currentRawResponse = null;
    setLoadingState(false);
  }
}

// Request content when sidepanel opens
async function requestContentFromActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      console.log('No active tab found');
      return;
    }

    if (!tab.url || !tab.url.startsWith('http')) {
      console.log('Tab is not a valid web page:', tab.url);
      return;
    }

    console.log('Loading analysis for tab:', tab.id, tab.url);
    currentTabId = tab.id;
    await loadStoredAnalysis(tab.id);
  } catch (error) {
    console.error('Error requesting content:', error);
  }
}

// Request content from active tab when sidepanel opens
requestContentFromActiveTab();

// Cleanup old tab results (older than 1 week)
async function cleanupOldTabResults() {
  try {
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    const now = Date.now();
    
    const { tabResults = {} } = await chrome.storage.local.get('tabResults');
    const cleanedResults = {};
    let cleanedCount = 0;
    
    // Filter out old results
    Object.entries(tabResults).forEach(([urlKey, data]) => {
      if (data.timestamp && (now - data.timestamp) < ONE_WEEK_MS) {
        cleanedResults[urlKey] = data;
      } else {
        cleanedCount++;
      }
    });
    
    // Only update storage if we actually cleaned something
    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} old URL results`);
      await chrome.storage.local.set({ tabResults: cleanedResults });
    }
  } catch (error) {
    console.error('Error cleaning up old URL results:', error);
  }
}

async function initializeExtension() {
  // Prevent multiple initializations
  if (window.extensionInitialized) {
    console.log('Extension already initialized, skipping');
    return;
  }
  window.extensionInitialized = true;

  try {
    // Clean up old results when the extension starts
    await cleanupOldTabResults();
    
    // Load API key from storage
    const { apiKey } = await chrome.storage.local.get(['apiKey']);
    if (apiKey) {
      document.getElementById('apiKey').value = apiKey;
      updateApiKeyStatus(apiKey);
    }
    
    // Get the current active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (tab) {
      console.log('Initial active tab:', tab);
      currentTabId = tab.id;
      if (tab.url && tab.url.startsWith('http')) {
        await loadStoredAnalysis(tab.id);
      }
    }
  } catch (error) {
    console.error('Error during initialization:', error);
  }
}
