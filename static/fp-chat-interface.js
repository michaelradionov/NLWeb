/**
 * Modern Chat Interface
 * A full-screen chat interface similar to Claude.ai and ChatGPT
 */

import { JsonRenderer } from './json-renderer.js';
import { TypeRendererFactory } from './type-renderers.js';
import { RecipeRenderer } from './recipe-renderer.js';
import { MapDisplay } from './display_map.js';

class ModernChatInterface {
  constructor(options = {}) {
    // Initialize properties
    this.conversations = [];
    this.currentConversationId = null;
    this.eventSource = null;
    this.isStreaming = false;
    this.currentStreamingMessage = null;
    this.prevQueries = [];  // Track previous queries
    this.lastAnswers = [];  // Track last answers
    this.rememberedItems = [];  // Track remembered items
    
    // Store options
    this.options = options;
    
    // Initialize JSON renderer
    this.jsonRenderer = new JsonRenderer();
    TypeRendererFactory.registerAll(this.jsonRenderer);
    TypeRendererFactory.registerRenderer(RecipeRenderer, this.jsonRenderer);
    
    // Get DOM elements
    this.elements = {
      sidebar: document.getElementById('sidebar'),
      sidebarToggle: document.getElementById('sidebar-toggle'),
      mobileMenuToggle: document.getElementById('mobile-menu-toggle'),
      newChatBtn: document.getElementById('new-chat-btn'),
      conversationsList: document.getElementById('conversations-list'),
      chatTitle: document.querySelector('.chat-title'),
      chatSiteInfo: document.getElementById('chat-site-info'),
      messagesContainer: document.getElementById('messages-container'),
      chatMessages: document.getElementById('chat-messages'),
      chatInput: document.getElementById('chat-input'),
      sendButton: document.getElementById('send-button')
    };
    
    // Debug mode state
    this.debugMode = false;
    this.debugMessages = [];
    
    // Initialize the interface
    this.init();
  }
  
  init() {
    // Initialize default values
    this.selectedSite = this.options.site || 'all';
    this.selectedMode = this.options.mode || 'list'; // Default generate_mode
    
    // Load saved conversations (async operation)
    this.loadConversations().then(() => {
      this.updateConversationsList();
    });
    
    // Load remembered items
    this.loadRememberedItems();
    this.updateRememberedItemsList();
    
    // Restore sidebar state
    const isCollapsed = localStorage.getItem('nlweb-sidebar-collapsed') === 'true';
    if (isCollapsed) {
      this.elements.sidebar.classList.add('collapsed');
      this.elements.sidebarToggle.classList.add('sidebar-collapsed');
    }
    
    // Bind events
    this.bindEvents();
    
    // Listen for auth state changes
    window.addEventListener('authStateChanged', async (event) => {
      // When auth state changes, reload conversations
      
      if (event.detail.isAuthenticated) {
        // User just logged in
        // First, try to migrate local conversations to server
        await this.migrateLocalConversations();
        
        // Then load all conversations from server
        await this.loadConversations();
        this.updateConversationsList();
      } else {
        // User logged out, clear server conversations and keep only local ones
        this.loadLocalConversations();
        this.updateConversationsList();
      }
    });
    
    // Start with a blank page - don't load previous conversations
    // Skip auto-creating new chat if skipAutoInit option is set
    if (!this.options.skipAutoInit) {
      console.log('Creating new chat on init...');
      this.createNewChat();
    }
  }
  
  bindEvents() {
    // Sidebar toggle
    this.elements.sidebarToggle.addEventListener('click', () => {
      this.elements.sidebar.classList.toggle('collapsed');
      this.elements.sidebarToggle.classList.toggle('sidebar-collapsed');
      
      // Save state to localStorage
      const isCollapsed = this.elements.sidebar.classList.contains('collapsed');
      localStorage.setItem('nlweb-sidebar-collapsed', isCollapsed);
    });
    
    // Mobile menu toggle
    this.elements.mobileMenuToggle.addEventListener('click', () => {
      this.elements.sidebar.classList.toggle('open');
    });
    
    // New chat button
    this.elements.newChatBtn.addEventListener('click', () => this.createNewChat());
    
    
    // Send button
    this.elements.sendButton.addEventListener('click', () => this.sendMessage());
    
    // Enter key to send
    this.elements.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    
    // Auto-resize textarea
    this.elements.chatInput.addEventListener('input', () => {
      this.elements.chatInput.style.height = 'auto';
      this.elements.chatInput.style.height = Math.min(this.elements.chatInput.scrollHeight, 200) + 'px';
    });
    
    // Mode selector
    const modeSelectorIcon = document.getElementById('mode-selector-icon');
    const modeDropdown = document.getElementById('mode-dropdown');
    
    if (modeSelectorIcon && modeDropdown) {
      modeSelectorIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        modeDropdown.classList.toggle('show');
      });
      
      // Mode selection
      const modeItems = modeDropdown.querySelectorAll('.mode-dropdown-item');
      modeItems.forEach(item => {
        item.addEventListener('click', () => {
          const mode = item.getAttribute('data-mode');
          this.selectedMode = mode;
          
          // Update UI
          modeItems.forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          modeDropdown.classList.remove('show');
          
          // Update icon title
          modeSelectorIcon.title = `Mode: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`;
        });
      });
      
      // Set initial selection
      const initialItem = modeDropdown.querySelector(`[data-mode="${this.selectedMode}"]`);
      if (initialItem) {
        initialItem.classList.add('selected');
      }
      modeSelectorIcon.title = `Mode: ${this.selectedMode.charAt(0).toUpperCase() + this.selectedMode.slice(1)}`;
    }
    
    // Click outside to close mode dropdown
    document.addEventListener('click', (e) => {
      if (modeDropdown && !e.target.closest('.input-mode-selector')) {
        modeDropdown.classList.remove('show');
      }
    });
  }
  
  createNewChat(existingInputElementId = null, site = null) {
    // Create new conversation
    // Create new conversation ID but don't add to conversations array yet
    this.currentConversationId = Date.now().toString();
    
    // Clear UI
    this.elements.messagesContainer.innerHTML = '';
    this.elements.chatTitle.textContent = 'New chat';
    this.elements.chatInput.value = '';
    this.elements.chatInput.style.height = 'auto';
    
    // Clear context arrays for new chat
    this.prevQueries = [];
    this.lastAnswers = [];
    
    // Update UI without saving
    this.updateConversationsList();
    
    // Show centered input for new chat or use existing element
    if (existingInputElementId) {
      // Use existing DOM element as input
      const existingInput = document.getElementById(existingInputElementId);
      if (existingInput) {
        // Store reference to the external input
        this.externalInput = existingInput;
        
        // Add event listener for sending message
        const sendHandler = (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const message = existingInput.value.trim();
            if (message) {
              this.sendMessage(message);
              existingInput.value = '';
            }
          }
        };
        
        // Remove any existing listeners and add new one
        existingInput.removeEventListener('keydown', sendHandler);
        existingInput.addEventListener('keydown', sendHandler);
        
        // Focus the external input
        existingInput.focus();
      } else {
        console.warn(`Element with id "${existingInputElementId}" not found. Falling back to centered input.`);
        this.showCenteredInput();
      }
    } else {
      // Show the default centered input
      console.log('Showing centered input from createNewChat');
      this.showCenteredInput();
    }
    
    // If site is specified, use it; otherwise load sites
    if (site) {
      this.selectedSite = site;
      // Update UI elements
      if (this.siteSelectorIcon) {
        this.siteSelectorIcon.title = `Site: ${site}`;
      }
      if (this.elements.chatSiteInfo) {
        this.elements.chatSiteInfo.textContent = `Asking ${site}`;
      }
    } else {
      // Load sites for the dropdown
      this.loadSites();
    }
  }
  
  loadConversation(id) {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return;
    
    this.currentConversationId = id;
    
    // Restore the site selection for this conversation
    if (conversation.site) {
      this.selectedSite = conversation.site;
      // Update the UI to reflect the site
      if (this.elements.chatSiteInfo) {
        this.elements.chatSiteInfo.textContent = `Asking ${conversation.site}`;
      }
      // Update site selector icon if it exists
      if (this.siteSelectorIcon) {
        this.siteSelectorIcon.title = `Site: ${conversation.site}`;
      }
    }
    
    // Clear messages
    this.elements.messagesContainer.innerHTML = '';
    
    // Rebuild context arrays from conversation history
    this.prevQueries = conversation.messages
      .filter(m => m.type === 'user')
      .slice(-10)
      .map(m => m.content);
    
    this.lastAnswers = [];
    const assistantMessages = conversation.messages.filter(m => m.type === 'assistant');
    for (const msg of assistantMessages.slice(-5)) {
      if (msg.parsedAnswers && Array.isArray(msg.parsedAnswers)) {
        this.lastAnswers.push(...msg.parsedAnswers);
      }
    }
    this.lastAnswers = this.lastAnswers.slice(-20);
    
    // Load messages
    conversation.messages.forEach((msg, index) => {
      // Set pendingDebugIcon for user messages so the next assistant message gets the icon
      if (msg.type === 'user' && index < conversation.messages.length - 1) {
        const nextMsg = conversation.messages[index + 1];
        if (nextMsg && nextMsg.type === 'assistant') {
          this.pendingDebugIcon = true;
        }
      }
      this.addMessageToUI(msg.content, msg.type, false);
    });
    
    // Update title
    const title = conversation.title || 'New chat';
    this.elements.chatTitle.textContent = title;
    
    // Update sidebar
    this.updateConversationsList();
    
    // Hide centered input and show regular chat input
    this.hideCenteredInput();
    
    // Scroll to bottom
    this.scrollToBottom();
  }
  
  sendMessage(messageText = null) {
    const message = messageText || this.elements.chatInput.value.trim();
    if (!message || this.isStreaming) return;
    
    // Add user message
    this.addMessage(message, 'user');
    
    // Clear input
    this.elements.chatInput.value = '';
    this.elements.chatInput.style.height = 'auto';
    
    // Get response
    this.getStreamingResponse(message);
  }
  
  addMessage(content, type) {
    // Add to UI
    this.addMessageToUI(content, type, true);
    
    // Find or create conversation
    let conversation = this.conversations.find(c => c.id === this.currentConversationId);
    
    // If conversation doesn't exist, create it now (this happens on first message)
    if (!conversation) {
      conversation = {
        id: this.currentConversationId,
        title: 'New chat',
        messages: [],
        timestamp: Date.now(),
        site: this.selectedSite || 'all'
      };
      this.conversations.unshift(conversation);
    }
    
    // Add message to conversation
    conversation.messages.push({ content, type, timestamp: Date.now() });
    
    // Update title if first message
    if (conversation.messages.length === 1 && type === 'user') {
      conversation.title = content.substring(0, 30) + (content.length > 30 ? '...' : '');
      this.elements.chatTitle.textContent = conversation.title;
    }
    
    conversation.timestamp = Date.now();
    this.saveConversations();
    this.updateConversationsList();
    
    // When user sends a message, we'll add debug icon to the next assistant message
    if (type === 'user') {
      this.pendingDebugIcon = true;
    }
  }
  
  addMessageToUI(content, type, animate = true) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;
    if (animate) {
      messageDiv.style.opacity = '0';
      messageDiv.style.transform = 'translateY(10px)';
    }
    
    // Create message layout container
    const messageLayout = document.createElement('div');
    messageLayout.className = 'message-layout';
    
    // Only create header row if there's a debug icon to show
    if (type === 'assistant' && this.pendingDebugIcon) {
      const headerRow = document.createElement('div');
      headerRow.className = 'message-layout-header';
      
      const debugIcon = document.createElement('span');
      debugIcon.className = 'message-debug-icon';
      debugIcon.textContent = '{}';
      debugIcon.title = 'Show debug info';
      debugIcon.addEventListener('click', () => this.toggleDebugInfo());
      headerRow.appendChild(debugIcon);
      this.pendingDebugIcon = false;
      
      messageLayout.appendChild(headerRow);
    }
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    
    // Handle different content types
    if (typeof content === 'string') {
      // For assistant messages with HTML content, use innerHTML
      if (type === 'assistant' && content.includes('<') && content.includes('>')) {
        textDiv.innerHTML = content;
      } else {
        textDiv.textContent = content;
      }
    } else if (content && content.html) {
      textDiv.innerHTML = content.html;
    } else {
      textDiv.textContent = JSON.stringify(content);
    }
    
    contentDiv.appendChild(textDiv);
    
    // Build the message structure
    messageLayout.appendChild(contentDiv);
    messageDiv.appendChild(messageLayout);
    
    this.elements.messagesContainer.appendChild(messageDiv);
    
    if (animate) {
      // Trigger animation
      setTimeout(() => {
        messageDiv.style.transition = 'all 0.3s ease';
        messageDiv.style.opacity = '1';
        messageDiv.style.transform = 'translateY(0)';
      }, 10);
    }
    
    // For user messages, scroll to bottom
    if (type === 'user') {
      this.scrollToBottom();
    }
    // For assistant messages, scrolling is handled when first result appears
    
    return { messageDiv, textDiv };
  }
  
  getStreamingResponse(query) {
    // Show loading state
    this.isStreaming = true;
    this.elements.sendButton.disabled = true;
    
    // Add assistant message with loading dots
    const loadingHtml = `
      <div class="loading-dots">
        <div class="loading-dot"></div>
        <div class="loading-dot"></div>
        <div class="loading-dot"></div>
      </div>
    `;
    
    const { messageDiv, textDiv } = this.addMessageToUI({ html: loadingHtml }, 'assistant');
    this.currentStreamingMessage = { 
      messageDiv, 
      textDiv, 
      content: '', 
      allResults: [],
      resultElements: new Map() // Map to store result element by item
    };
    
    // Build URL with parameters - using 'query' instead of 'question'
    const params = new URLSearchParams({
      query: query,  // Changed from 'question' to 'query'
      generate_mode: this.selectedMode || 'list',
      display_mode: 'full',
      site: this.selectedSite || 'all'
    });
    
    // Add previous queries (not including current query)
    if (this.prevQueries.length > 0) {
      params.append('prev', JSON.stringify(this.prevQueries));
    }
    
    // Add last answers for context
    if (this.lastAnswers.length > 0) {
      params.append('last_ans', JSON.stringify(this.lastAnswers));
    }
    
    // Add remembered items
    if (this.rememberedItems.length > 0) {
      params.append('item_to_remember', this.rememberedItems.join(', '));
    }
    
    // Add authentication token and user ID if available
    const authToken = localStorage.getItem('authToken');
    const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
    if (authToken) {
      params.append('auth_token', authToken);
    }
    if (userInfo && userInfo.id) {
      params.append('oauth_id', userInfo.id);
      params.append('user_id', userInfo.id);
    } else if (userInfo && userInfo.email) {
      // Use email as user_id if id is not available
      params.append('oauth_id', userInfo.email);
      params.append('user_id', userInfo.email);
    }
    
    // Add thread_id (current conversation ID)
    if (this.currentConversationId) {
      params.append('thread_id', this.currentConversationId);
    }
    
    // Create event source with full URL
    const baseUrl = window.location.origin === 'file://' ? 'http://localhost:8000' : '';
    const url = `${baseUrl}/ask?${params.toString()}`;
    
    
    // Use native EventSource directly
    this.eventSource = new EventSource(url);
    
    let firstChunk = true;
    let firstResultShown = false;
    let messageContent = '';
    let allResults = [];
    
    // Clear debug messages for new request
    this.debugMessages = [];
    
    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Always store debug messages for the current request
        this.debugMessages.push({
          type: data.message_type || 'unknown',
          data: data,
          timestamp: new Date().toISOString()
        });
        
        if (firstChunk) {
          // Clear loading dots
          textDiv.innerHTML = '';
          firstChunk = false;
        }
        
        // Scroll to user message when first actual result appears
        if (!firstResultShown && (data.message_type === 'fast_track' || 
            (data.message_type === 'content' && data.content) || 
            (data.items && data.items.length > 0))) {
          firstResultShown = true;
          this.scrollToUserMessage();
        }
        
        // Always clear temp_intermediate divs when ANY new message arrives
        if (textDiv) {
          const tempDivs = textDiv.querySelectorAll('.temp_intermediate');
          tempDivs.forEach(div => div.remove());
        }
        
        // Handle different message types
        if (data.message_type === 'summary' && data.message) {
          messageContent += data.message + '\n\n';
          textDiv.innerHTML = messageContent + this.renderItems(allResults);
        } else if (data.message_type === 'result_batch' && data.results) {
          // Accumulate all results instead of replacing
          allResults = allResults.concat(data.results);
          textDiv.innerHTML = messageContent + this.renderItems(allResults);
        } else if (data.message_type === 'intermediate_message') {
          // Handle intermediate messages with temp_intermediate class
          const tempContainer = document.createElement('div');
          tempContainer.className = 'temp_intermediate';
          
          if (data.results) {
            // Use the same rendering as result_batch
            tempContainer.innerHTML = this.renderItems(data.results);
          } else if (data.message) {
            // Handle text-only intermediate messages in italics
            const textSpan = document.createElement('span');
            textSpan.style.fontStyle = 'italic';
            textSpan.textContent = data.message;
            tempContainer.appendChild(textSpan);
          }
          
          // Update textDiv to include existing content plus the temp container
          textDiv.innerHTML = messageContent + this.renderItems(allResults);
          textDiv.appendChild(tempContainer);
        } else if (data.message_type === 'ask_user' && data.message) {
          messageContent += data.message + '\n';
          textDiv.innerHTML = messageContent + this.renderItems(allResults);
        } else if (data.message_type === 'asking_sites' && data.message) {
          messageContent += `Searching: ${data.message}\n\n`;
          textDiv.innerHTML = messageContent + this.renderItems(allResults);
        } else if (data.message_type === 'decontextualized_query') {
          // Display the decontextualized query if different from original
          if (data.decontextualized_query && data.original_query && 
              data.decontextualized_query !== data.original_query) {
            const decontextMsg = `<div style="font-style: italic; color: #666; margin-bottom: 10px;">Query interpreted as: "${data.decontextualized_query}"</div>`;
            messageContent = decontextMsg + messageContent;
            textDiv.innerHTML = messageContent + this.renderItems(allResults);
          }
        } else if (data.message_type === 'item_details') {
          // Handle item_details message type
          // Map details to description for proper rendering
          let description = data.details;
          
          // If details is an object (like nutrition info), format it as a string
          if (typeof data.details === 'object' && data.details !== null) {
            description = Object.entries(data.details)
              .map(([key, value]) => `${key}: ${value}`)
              .join(', ');
          }
          
          const mappedData = {
            ...data,
            description: description
          };
          
          // Add to results array
          allResults.push(mappedData);
          textDiv.innerHTML = messageContent + this.renderItems(allResults);
        } else if (data.message_type === 'ensemble_result') {
          // Handle ensemble result message type
          if (data.result && data.result.recommendations) {
            const ensembleHtml = this.renderEnsembleResult(data.result);
            textDiv.innerHTML = messageContent + ensembleHtml + this.renderItems(allResults);
          }
        } else if (data.message_type === 'remember' && data.item_to_remember) {
          // Handle remember message
          const rememberMsg = `<div style="background-color: #e8f4f8; padding: 10px; border-radius: 6px; margin-bottom: 10px; color: #0066cc;">I will remember that</div>`;
          messageContent = rememberMsg + messageContent;
          textDiv.innerHTML = messageContent + this.renderItems(allResults);
          
          // Add to remembered items
          this.addRememberedItem(data.item_to_remember);
        } else if (data.message_type === 'query_analysis') {
          // Handle query analysis which may include decontextualized query
          if (data.decontextualized_query && query && 
              data.decontextualized_query !== query) {
            const decontextMsg = `<div style="font-style: italic; color: #666; margin-bottom: 10px;">Query interpreted as: "${data.decontextualized_query}"</div>`;
            messageContent = decontextMsg + messageContent;
            textDiv.innerHTML = messageContent + this.renderItems(allResults);
          }
          
          // Also check for item_to_remember in query_analysis
          if (data.item_to_remember) {
            const rememberMsg = `<div style="background-color: #e8f4f8; padding: 10px; border-radius: 6px; margin-bottom: 10px; color: #0066cc;">I will remember that: "${data.item_to_remember}"</div>`;
            messageContent = rememberMsg + messageContent;
            textDiv.innerHTML = messageContent + this.renderItems(allResults);
            
            // Add to remembered items
            this.addRememberedItem(data.item_to_remember);
          }

        } else if (data.message_type === 'api_key') {
          // Handle API key configuration EARLY to ensure it's available for maps
          console.log('=== API KEY MESSAGE RECEIVED ===');
          console.log('API key message:', data);
          console.log('Before setting - window.GOOGLE_MAPS_API_KEY:', window.GOOGLE_MAPS_API_KEY);
          if (data.key_name === 'google_maps' && data.key_value) {
            // Store the Google Maps API key globally
            window.GOOGLE_MAPS_API_KEY = data.key_value;
            console.log('Google Maps API key set from server:', data.key_value.substring(0, 10) + '...');
            console.log('After setting - window.GOOGLE_MAPS_API_KEY:', window.GOOGLE_MAPS_API_KEY.substring(0, 10) + '...');
            // Verify it's actually set
            console.log('Verification - window.GOOGLE_MAPS_API_KEY exists?', !!window.GOOGLE_MAPS_API_KEY);
            console.log('Verification - typeof window.GOOGLE_MAPS_API_KEY:', typeof window.GOOGLE_MAPS_API_KEY);
          } else {
            console.log('API key message not for google_maps or no value');
            console.log('key_name:', data.key_name, 'has value?', !!data.key_value);
          }
          
        } else if (data.message_type === 'chart_result') {
          // Handle chart result (web components)
          console.log('=== Chart Result Handler Called ===');
          console.log('Received chart data:', data);
          
          if (data.html) {
            // Create container for the chart
            const chartContainer = document.createElement('div');
            chartContainer.className = 'chart-result-container';
            chartContainer.style.cssText = 'margin: 15px 0; padding: 15px; background-color: #f8f9fa; border-radius: 8px; min-height: 400px;';
            
            // Parse the HTML to extract just the web component (remove script tags)
            const parser = new DOMParser();
            const doc = parser.parseFromString(data.html, 'text/html');
            
            // Find all datacommons elements
            const datacommonsElements = doc.querySelectorAll('[datacommons-scatter], [datacommons-bar], [datacommons-line], [datacommons-pie], [datacommons-map], datacommons-scatter, datacommons-bar, datacommons-line, datacommons-pie, datacommons-map');
            
            // Append each web component directly
            datacommonsElements.forEach(element => {
              // Clone the element to ensure we get all attributes
              const clonedElement = element.cloneNode(true);
              chartContainer.appendChild(clonedElement);
              console.log('Added web component:', clonedElement.tagName, clonedElement.outerHTML);
            });
            
            // If no datacommons elements found, try to add the raw HTML (excluding scripts)
            if (datacommonsElements.length === 0) {
              const allElements = doc.body.querySelectorAll('*:not(script)');
              allElements.forEach(element => {
                chartContainer.appendChild(element.cloneNode(true));
              });
            }
            
            // Append the chart to the message content
            textDiv.innerHTML = messageContent + this.renderItems(allResults);
            textDiv.appendChild(chartContainer);
            
            console.log('Chart container appended to message with', datacommonsElements.length, 'web components');
            
            // Force re-initialization of Data Commons components if available
            if (window.datacommons && window.datacommons.init) {
              setTimeout(() => {
                window.datacommons.init();
                console.log('Data Commons re-initialized');
              }, 100);
            }
          }

        } else if (data.message_type === 'results_map') {
          // Handle results map
          console.log('=== RESULTS_MAP MESSAGE RECEIVED ===');
          console.log('Message data:', JSON.stringify(data, null, 2));
          
          if (data.locations && Array.isArray(data.locations) && data.locations.length > 0) {
            console.log('Creating map with locations:', data.locations);
            
            // Create container for the map
            const mapContainer = document.createElement('div');
            mapContainer.className = 'results-map-container';
            mapContainer.style.cssText = 'margin: 15px 0; padding: 15px; background-color: #f8f9fa; border-radius: 8px;';
            
            // Create the map div
            const mapDiv = document.createElement('div');
            mapDiv.id = 'results-map-' + Date.now();
            mapDiv.style.cssText = 'width: 100%; height: 250px; border-radius: 6px;';
            
            // Add a title
            const mapTitle = document.createElement('h3');
            mapTitle.textContent = 'Result Locations';
            mapTitle.style.cssText = 'margin: 0 0 10px 0; color: #333; font-size: 1.1em;';
            
            mapContainer.appendChild(mapTitle);
            mapContainer.appendChild(mapDiv);
            
            // Prepend map BEFORE the results
            textDiv.innerHTML = ''; // Clear existing content
            textDiv.appendChild(mapContainer); // Add map first
            
            // Then add the message content and results
            const contentDiv = document.createElement('div');
            contentDiv.innerHTML = messageContent + this.renderItems(allResults);
            textDiv.appendChild(contentDiv);
            
            console.log('Map container appended, calling MapDisplay.initializeResultsMap');
            
            // Initialize the map using the imported MapDisplay class
            MapDisplay.initializeResultsMap(mapDiv, data.locations);
          } else {
            console.log('No valid locations data in results_map message');
          }

        } else if (data.message_type === 'complete') {
          this.endStreaming();
          return; // Exit early to avoid setting content on null
        }
        
        // Only update content if streaming message still exists
        if (this.currentStreamingMessage) {
          this.currentStreamingMessage.content = messageContent;
          this.currentStreamingMessage.allResults = allResults;
        }
      } catch (e) {
        console.error('Error parsing streaming data:', e);
      }
    };
    
    this.eventSource.onerror = (error) => {
      console.error('Streaming error:', error);
      this.endStreaming();
      
      if (firstChunk) {
        textDiv.innerHTML = 'Sorry, an error occurred while processing your request.';
      }
    };
    
    this.eventSource.onopen = () => {
      console.log('EventSource connection opened');
    };
    
    // Add current query to prevQueries after sending (keep last 10)
    this.prevQueries.push(query);
    if (this.prevQueries.length > 10) {
      this.prevQueries = this.prevQueries.slice(-10);
    }
  }
  
  handleStreamingData(data) {
    const textDiv = this.currentStreamingMessage.textDiv;
    
    if (data.type === 'content') {
      // Append content
      this.currentStreamingMessage.content += data.text || '';
      textDiv.textContent = this.currentStreamingMessage.content;
    } else if (data.type === 'items') {
      // Handle search results
      if (data.items && data.items.length > 0) {
        const itemsHtml = this.renderItems(data.items);
        textDiv.innerHTML = this.currentStreamingMessage.content + itemsHtml;
      }
    } else if (data.type === 'complete') {
      // Stream complete
      this.endStreaming();
    }
  }
  
  renderItems(items) {
    if (!items || items.length === 0) return '';
    
    // Sort items by score in descending order
    const sortedItems = [...items].sort((a, b) => {
      const scoreA = a.score || 0;
      const scoreB = b.score || 0;
      return scoreB - scoreA;
    });
    
    // Create a container for all results
    const resultsContainer = document.createElement('div');
    resultsContainer.className = 'search-results';
    
    sortedItems.forEach(item => {
      // Use JsonRenderer to create the item HTML
      const itemElement = this.jsonRenderer.createJsonItemHtml(item);
      
      // No inline styles - let CSS handle all styling
      
      resultsContainer.appendChild(itemElement);
    });
    
    // Return the outer HTML of the container
    return resultsContainer.outerHTML;
  }
  
  renderEnsembleResult(result) {
    const recommendations = result.recommendations;
    if (!recommendations) return '';
    
    // Create ensemble result container
    const container = document.createElement('div');
    container.className = 'ensemble-result-container';
    container.style.cssText = 'background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 10px 0;';
    
    // Add theme header
    if (recommendations.theme) {
      const themeHeader = document.createElement('h3');
      themeHeader.textContent = recommendations.theme;
      themeHeader.style.cssText = 'color: #333; margin-bottom: 20px; font-size: 1.2em;';
      container.appendChild(themeHeader);
    }
    
    // Add items
    if (recommendations.items && Array.isArray(recommendations.items)) {
      const itemsContainer = document.createElement('div');
      itemsContainer.style.cssText = 'display: grid; gap: 15px;';
      
      recommendations.items.forEach(item => {
        const itemCard = this.createEnsembleItemCard(item);
        itemsContainer.appendChild(itemCard);
      });
      
      container.appendChild(itemsContainer);
    }
    
    // Add overall tips
    if (recommendations.overall_tips && Array.isArray(recommendations.overall_tips)) {
      const tipsSection = document.createElement('div');
      tipsSection.style.cssText = 'margin-top: 20px; padding-top: 20px; border-top: 1px solid #dee2e6;';
      
      const tipsHeader = document.createElement('h4');
      tipsHeader.textContent = 'Planning Tips';
      tipsHeader.style.cssText = 'color: #555; margin-bottom: 10px; font-size: 1.1em;';
      tipsSection.appendChild(tipsHeader);
      
      const tipsList = document.createElement('ul');
      tipsList.style.cssText = 'margin: 0; padding-left: 20px;';
      
      recommendations.overall_tips.forEach(tip => {
        const tipItem = document.createElement('li');
        tipItem.textContent = tip;
        tipItem.style.cssText = 'color: #666; margin-bottom: 5px;';
        tipsList.appendChild(tipItem);
      });
      
      tipsSection.appendChild(tipsList);
      container.appendChild(tipsSection);
    }
    
    return container.outerHTML;
  }
  
  createEnsembleItemCard(item) {
    const card = document.createElement('div');
    card.style.cssText = 'background: white; padding: 15px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);';
    
    // Create a flex container for content and image
    const flexContainer = document.createElement('div');
    flexContainer.style.cssText = 'display: flex; gap: 15px; align-items: center;';
    
    // Content container (goes first, on the left)
    const contentContainer = document.createElement('div');
    contentContainer.style.cssText = 'flex-grow: 1;';
    
    // Category badge
    const categoryBadge = document.createElement('span');
    categoryBadge.textContent = item.category;
    categoryBadge.style.cssText = `
      display: inline-block;
      padding: 4px 12px;
      background-color: ${item.category === 'Garden' ? '#28a745' : '#007bff'};
      color: white;
      border-radius: 20px;
      font-size: 0.85em;
      margin-bottom: 10px;
    `;
    contentContainer.appendChild(categoryBadge);
    
    // Name with hyperlink
    const nameContainer = document.createElement('h4');
    nameContainer.style.cssText = 'margin: 10px 0;';
    
    // Get URL from item or schema_object
    const itemUrl = item.url || (item.schema_object && item.schema_object.url);
    
    if (itemUrl) {
      const nameLink = document.createElement('a');
      nameLink.href = itemUrl;
      nameLink.textContent = item.name;
      nameLink.target = '_blank';
      nameLink.style.cssText = 'color: #0066cc; text-decoration: none; font-weight: bold;';
      nameLink.onmouseover = function() { this.style.textDecoration = 'underline'; };
      nameLink.onmouseout = function() { this.style.textDecoration = 'none'; };
      nameContainer.appendChild(nameLink);
    } else {
      nameContainer.textContent = item.name;
      nameContainer.style.color = '#333';
    }
    
    contentContainer.appendChild(nameContainer);
    
    // Description
    const description = document.createElement('p');
    description.textContent = item.description;
    description.style.cssText = 'color: #666; margin: 10px 0; line-height: 1.5;';
    contentContainer.appendChild(description);
    
    // Why recommended
    const whySection = document.createElement('div');
    whySection.style.cssText = 'background-color: #e8f4f8; padding: 10px; border-radius: 4px; margin: 10px 0;';
    
    const whyLabel = document.createElement('strong');
    whyLabel.textContent = 'Why recommended: ';
    whyLabel.style.cssText = 'color: #0066cc;';
    
    const whyText = document.createElement('span');
    whyText.textContent = item.why_recommended;
    whyText.style.cssText = 'color: #555;';
    
    whySection.appendChild(whyLabel);
    whySection.appendChild(whyText);
    contentContainer.appendChild(whySection);
    
    // Details
    if (item.details && Object.keys(item.details).length > 0) {
      const detailsSection = document.createElement('div');
      detailsSection.style.cssText = 'margin-top: 10px; font-size: 0.9em;';
      
      Object.entries(item.details).forEach(([key, value]) => {
        const detailLine = document.createElement('div');
        detailLine.style.cssText = 'color: #777; margin: 3px 0;';
        
        const detailKey = document.createElement('strong');
        detailKey.textContent = `${key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')}: `;
        detailKey.style.cssText = 'color: #555;';
        
        const detailValue = document.createElement('span');
        detailValue.textContent = value;
        
        detailLine.appendChild(detailKey);
        detailLine.appendChild(detailValue);
        detailsSection.appendChild(detailLine);
      });
      
      contentContainer.appendChild(detailsSection);
    }
    
    // Additional info from schema_object
    if (item.schema_object) {
      // Price
      if (item.schema_object.price || (item.schema_object.offers && item.schema_object.offers.price)) {
        const priceDiv = document.createElement('div');
        priceDiv.style.cssText = 'margin-top: 10px; font-weight: bold; color: #28a745;';
        const price = item.schema_object.price || item.schema_object.offers.price;
        priceDiv.textContent = `Price: ${typeof price === 'object' ? price.value : price}`;
        contentContainer.appendChild(priceDiv);
      }
      
      // Rating
      if (item.schema_object.aggregateRating) {
        const rating = item.schema_object.aggregateRating;
        const ratingValue = rating.ratingValue || rating.value;
        const reviewCount = rating.reviewCount || rating.ratingCount || rating.count;
        
        if (ratingValue) {
          const ratingDiv = document.createElement('div');
          ratingDiv.style.cssText = 'margin-top: 5px; color: #f39c12;';
          const stars = '★'.repeat(Math.round(ratingValue));
          const reviewText = reviewCount ? ` (${reviewCount} reviews)` : '';
          ratingDiv.innerHTML = `Rating: ${stars} ${ratingValue}/5${reviewText}`;
          contentContainer.appendChild(ratingDiv);
        }
      }
    }
    
    // Append content container to flex container
    flexContainer.appendChild(contentContainer);
    
    // Add image from schema_object if available (on the right side)
    if (item.schema_object) {
      const imageUrl = this.extractImageUrl(item.schema_object);
      
      if (imageUrl) {
        const imageContainer = document.createElement('div');
        imageContainer.style.cssText = 'flex-shrink: 0; display: flex; align-items: center;';
        
        const image = document.createElement('img');
        image.src = imageUrl;
        image.alt = item.name;
        image.style.cssText = 'width: 120px; height: 120px; object-fit: cover; border-radius: 6px;';
        imageContainer.appendChild(image);
        flexContainer.appendChild(imageContainer);
      }
    }
    
    // Append flex container to card
    card.appendChild(flexContainer);
    
    return card;
  }
  
  extractImageUrl(schema_object) {
    if (!schema_object) return null;
    
    // Check various possible image fields
    if (schema_object.image) {
      return this.extractImageUrlFromField(schema_object.image);
    } else if (schema_object.images && Array.isArray(schema_object.images) && schema_object.images.length > 0) {
      return this.extractImageUrlFromField(schema_object.images[0]);
    } else if (schema_object.thumbnailUrl) {
      return this.extractImageUrlFromField(schema_object.thumbnailUrl);
    } else if (schema_object.thumbnail) {
      return this.extractImageUrlFromField(schema_object.thumbnail);
    }
    
    return null;
  }
  
  extractImageUrlFromField(imageField) {
    // Handle string URLs
    if (typeof imageField === 'string') {
      return imageField;
    }
    
    // Handle object with url property
    if (typeof imageField === 'object' && imageField !== null) {
      if (imageField.url) {
        return imageField.url;
      }
      if (imageField.contentUrl) {
        return imageField.contentUrl;
      }
      if (imageField['@id']) {
        return imageField['@id'];
      }
    }
    
    // Handle array of images
    if (Array.isArray(imageField) && imageField.length > 0) {
      return this.extractImageUrlFromField(imageField[0]);
    }
    
    return null;
  }
  
  endStreaming() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    
    this.isStreaming = false;
    this.elements.sendButton.disabled = false;
    
    // Save the final message
    if (this.currentStreamingMessage) {
      const finalContent = this.currentStreamingMessage.textDiv.innerHTML || this.currentStreamingMessage.content;
      const conversation = this.conversations.find(c => c.id === this.currentConversationId);
      if (conversation) {
        // Extract answers (title and URL) from the accumulated results
        const parsedAnswers = [];
        if (this.currentStreamingMessage.allResults && Array.isArray(this.currentStreamingMessage.allResults)) {
          for (const item of this.currentStreamingMessage.allResults) {
            if ((item.title || item.name) && item.url) {
              parsedAnswers.push({
                title: item.title || item.name,
                url: item.url
              });
            }
          }
        }
        
        // Update global lastAnswers array (keep last 20)
        if (parsedAnswers.length > 0) {
          this.lastAnswers = [...parsedAnswers, ...this.lastAnswers].slice(0, 20);
        }
        
        // Update the last assistant message
        const lastMessage = conversation.messages[conversation.messages.length - 1];
        if (lastMessage && lastMessage.type === 'assistant') {
          lastMessage.content = finalContent;
          lastMessage.parsedAnswers = parsedAnswers;
        } else {
          conversation.messages.push({ 
            content: finalContent, 
            type: 'assistant', 
            timestamp: Date.now(),
            parsedAnswers: parsedAnswers
          });
        }
        this.saveConversations();
      }
    }
    
    this.currentStreamingMessage = null;
  }
  
  renderEnsembleResult(result) {
    if (!result || !result.recommendations) return '';
    
    const recommendations = result.recommendations;
    
    // Create ensemble result container
    const container = document.createElement('div');
    container.className = 'ensemble-result-container';
    container.style.cssText = 'background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 16px 0;';
    
    // Add theme header
    if (recommendations.theme) {
      const themeHeader = document.createElement('h3');
      themeHeader.textContent = recommendations.theme;
      themeHeader.style.cssText = 'color: #333; margin-bottom: 20px; font-size: 1.2em;';
      container.appendChild(themeHeader);
    }
    
    // Add items
    if (recommendations.items && Array.isArray(recommendations.items)) {
      const itemsContainer = document.createElement('div');
      itemsContainer.style.cssText = 'display: grid; gap: 15px;';
      
      recommendations.items.forEach(item => {
        const itemCard = this.createEnsembleItemCard(item);
        itemsContainer.appendChild(itemCard);
      });
      
      container.appendChild(itemsContainer);
    }
    
    // Add overall tips
    if (recommendations.overall_tips && Array.isArray(recommendations.overall_tips)) {
      const tipsSection = document.createElement('div');
      tipsSection.style.cssText = 'margin-top: 20px; padding-top: 20px; border-top: 1px solid #dee2e6;';
      
      const tipsHeader = document.createElement('h4');
      tipsHeader.textContent = 'Planning Tips';
      tipsHeader.style.cssText = 'color: #555; margin-bottom: 10px; font-size: 1.1em;';
      tipsSection.appendChild(tipsHeader);
      
      const tipsList = document.createElement('ul');
      tipsList.style.cssText = 'margin: 0; padding-left: 20px;';
      
      recommendations.overall_tips.forEach(tip => {
        const tipItem = document.createElement('li');
        tipItem.textContent = tip;
        tipItem.style.cssText = 'color: #666; margin-bottom: 5px;';
        tipsList.appendChild(tipItem);
      });
      
      tipsSection.appendChild(tipsList);
      container.appendChild(tipsSection);
    }
    
    return container.outerHTML;
  }
  
  createEnsembleItemCard(item) {
    const card = document.createElement('div');
    card.style.cssText = 'background: white; padding: 15px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);';
    
    // Create a flex container for content and image
    const flexContainer = document.createElement('div');
    flexContainer.style.cssText = 'display: flex; gap: 15px; align-items: center;';
    
    // Content container (goes first, on the left)
    const contentContainer = document.createElement('div');
    contentContainer.style.cssText = 'flex-grow: 1;';
    
    // Category badge
    if (item.category) {
      const categoryBadge = document.createElement('span');
      categoryBadge.textContent = item.category;
      categoryBadge.style.cssText = `
        display: inline-block;
        padding: 4px 12px;
        background-color: ${item.category === 'Garden' ? '#28a745' : '#007bff'};
        color: white;
        border-radius: 20px;
        font-size: 0.85em;
        margin-bottom: 10px;
      `;
      contentContainer.appendChild(categoryBadge);
    }
    
    // Name with hyperlink
    const nameContainer = document.createElement('h4');
    nameContainer.style.cssText = 'margin: 10px 0;';
    
    // Get URL from item or schema_object
    const itemUrl = item.url || (item.schema_object && item.schema_object.url);
    
    if (itemUrl) {
      const nameLink = document.createElement('a');
      nameLink.href = itemUrl;
      nameLink.textContent = item.name;
      nameLink.target = '_blank';
      nameLink.style.cssText = 'color: #0066cc; text-decoration: none; font-weight: bold;';
      nameLink.onmouseover = function() { this.style.textDecoration = 'underline'; };
      nameLink.onmouseout = function() { this.style.textDecoration = 'none'; };
      nameContainer.appendChild(nameLink);
    } else {
      nameContainer.textContent = item.name;
      nameContainer.style.color = '#333';
    }
    
    contentContainer.appendChild(nameContainer);
    
    // Description
    if (item.description) {
      const description = document.createElement('p');
      description.textContent = item.description;
      description.style.cssText = 'color: #666; margin: 10px 0; line-height: 1.5;';
      contentContainer.appendChild(description);
    }
    
    // Why recommended
    if (item.why_recommended) {
      const whySection = document.createElement('div');
      whySection.style.cssText = 'background-color: #e8f4f8; padding: 10px; border-radius: 4px; margin: 10px 0;';
      
      const whyLabel = document.createElement('strong');
      whyLabel.textContent = 'Why recommended: ';
      whyLabel.style.cssText = 'color: #0066cc;';
      
      const whyText = document.createElement('span');
      whyText.textContent = item.why_recommended;
      whyText.style.cssText = 'color: #555;';
      
      whySection.appendChild(whyLabel);
      whySection.appendChild(whyText);
      contentContainer.appendChild(whySection);
    }
    
    // Details
    if (item.details && Object.keys(item.details).length > 0) {
      const detailsSection = document.createElement('div');
      detailsSection.style.cssText = 'margin-top: 10px; font-size: 0.9em;';
      
      Object.entries(item.details).forEach(([key, value]) => {
        const detailLine = document.createElement('div');
        detailLine.style.cssText = 'color: #777; margin: 3px 0;';
        
        const detailKey = document.createElement('strong');
        detailKey.textContent = `${key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')}: `;
        detailKey.style.cssText = 'color: #555;';
        
        const detailValue = document.createElement('span');
        detailValue.textContent = value;
        
        detailLine.appendChild(detailKey);
        detailLine.appendChild(detailValue);
        detailsSection.appendChild(detailLine);
      });
      
      contentContainer.appendChild(detailsSection);
    }
    
    // Additional info from schema_object
    if (item.schema_object) {
      // Price
      if (item.schema_object.price || (item.schema_object.offers && item.schema_object.offers.price)) {
        const priceDiv = document.createElement('div');
        priceDiv.style.cssText = 'margin-top: 10px; font-weight: bold; color: #28a745;';
        const price = item.schema_object.price || item.schema_object.offers.price;
        priceDiv.textContent = `Price: ${typeof price === 'object' ? price.value : price}`;
        contentContainer.appendChild(priceDiv);
      }
      
      // Rating
      if (item.schema_object.aggregateRating) {
        const rating = item.schema_object.aggregateRating;
        const ratingValue = rating.ratingValue || rating.value;
        const reviewCount = rating.reviewCount || rating.ratingCount || rating.count;
        
        if (ratingValue) {
          const ratingDiv = document.createElement('div');
          ratingDiv.style.cssText = 'margin-top: 5px; color: #f39c12;';
          const stars = '★'.repeat(Math.round(ratingValue));
          const reviewText = reviewCount ? ` (${reviewCount} reviews)` : '';
          ratingDiv.innerHTML = `Rating: ${stars} ${ratingValue}/5${reviewText}`;
          contentContainer.appendChild(ratingDiv);
        }
      }
    }
    
    // Append content container to flex container
    flexContainer.appendChild(contentContainer);
    
    // Add image from schema_object if available (on the right side)
    if (item.schema_object) {
      const imageUrl = this.extractImageUrl(item.schema_object);
      
      if (imageUrl) {
        const imageContainer = document.createElement('div');
        imageContainer.style.cssText = 'flex-shrink: 0; display: flex; align-items: center;';
        
        const image = document.createElement('img');
        image.src = imageUrl;
        image.alt = item.name;
        image.style.cssText = 'width: 120px; height: 120px; object-fit: cover; border-radius: 6px;';
        imageContainer.appendChild(image);
        flexContainer.appendChild(imageContainer);
      }
    }
    
    // Append flex container to card
    card.appendChild(flexContainer);
    
    return card;
  }
  
  extractImageUrl(schema_object) {
    if (!schema_object) return null;
    
    // Check various possible image fields
    if (schema_object.image) {
      return this.extractImageUrlFromField(schema_object.image);
    } else if (schema_object.images && Array.isArray(schema_object.images) && schema_object.images.length > 0) {
      return this.extractImageUrlFromField(schema_object.images[0]);
    } else if (schema_object.thumbnailUrl) {
      return this.extractImageUrlFromField(schema_object.thumbnailUrl);
    } else if (schema_object.thumbnail) {
      return this.extractImageUrlFromField(schema_object.thumbnail);
    }
    
    return null;
  }
  
  extractImageUrlFromField(imageField) {
    // Handle string URLs
    if (typeof imageField === 'string') {
      return imageField;
    }
    
    // Handle object with url property
    if (typeof imageField === 'object' && imageField !== null) {
      if (imageField.url) {
        return imageField.url;
      }
      if (imageField.contentUrl) {
        return imageField.contentUrl;
      }
      if (imageField['@id']) {
        return imageField['@id'];
      }
    }
    
    // Handle array of images
    if (Array.isArray(imageField) && imageField.length > 0) {
      return this.extractImageUrlFromField(imageField[0]);
    }
    
    return null;
  }
  
  
  /**
   * Updates the list of conversations displayed in the UI.
   * 
   * @param {HTMLElement|null} container - The container element where the conversations list will be rendered.
   *                                       If null, defaults to `this.elements.conversationsList`.
   */
  updateConversationsList(container = null) {
    // Use provided container or default to the sidebar conversations list
    const targetContainer = container || this.elements.conversationsList;
    if (!targetContainer) return;
    
    targetContainer.innerHTML = '';
    
    // Only show conversations that have messages
    const conversationsWithContent = this.conversations.filter(conv => conv.messages && conv.messages.length > 0);
    
    // Group conversations by site
    const conversationsBySite = {};
    conversationsWithContent.forEach(conv => {
      const site = conv.site || 'all';
      if (!conversationsBySite[site]) {
        conversationsBySite[site] = [];
      }
      conversationsBySite[site].push(conv);
    });
    
    // Sort sites alphabetically, but keep 'all' at the top
    const sites = Object.keys(conversationsBySite).sort((a, b) => {
      if (a === 'all') return -1;
      if (b === 'all') return 1;
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    
    // Create UI for each site group
    sites.forEach(site => {
      const conversations = conversationsBySite[site];
      
      // Create site header
      const siteHeader = document.createElement('div');
      siteHeader.className = 'site-group-header';
      
      // Add site name
      const siteName = document.createElement('span');
      siteName.textContent = site;
      siteHeader.appendChild(siteName);
      
      // Add chevron icon
      const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chevron.setAttribute('class', 'chevron');
      chevron.setAttribute('viewBox', '0 0 24 24');
      chevron.setAttribute('fill', 'none');
      chevron.setAttribute('stroke', 'currentColor');
      chevron.setAttribute('stroke-width', '2');
      chevron.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
      siteHeader.appendChild(chevron);
      
      // Create container for conversations
      const conversationsContainer = document.createElement('div');
      conversationsContainer.className = 'site-conversations';
      
      // Check if this group should be collapsed (stored in localStorage)
      const isCollapsed = localStorage.getItem(`nlweb-site-collapsed-${site}`) === 'true';
      if (isCollapsed) {
        siteHeader.classList.add('collapsed');
        conversationsContainer.classList.add('collapsed');
      }
      
      // Add click handler to toggle collapse
      siteHeader.addEventListener('click', () => {
        const isCurrentlyCollapsed = siteHeader.classList.contains('collapsed');
        if (isCurrentlyCollapsed) {
          siteHeader.classList.remove('collapsed');
          conversationsContainer.classList.remove('collapsed');
          localStorage.setItem(`nlweb-site-collapsed-${site}`, 'false');
        } else {
          siteHeader.classList.add('collapsed');
          conversationsContainer.classList.add('collapsed');
          localStorage.setItem(`nlweb-site-collapsed-${site}`, 'true');
        }
      });
      
      targetContainer.appendChild(siteHeader);
      
      // Add conversations for this site
      conversations.forEach(conv => {
        const item = document.createElement('div');
        item.className = 'conversation-item';
        if (conv.id === this.currentConversationId) {
          item.classList.add('active');
        }
        
        // Create title span
        const titleSpan = document.createElement('span');
        titleSpan.className = 'conversation-title';
        titleSpan.textContent = conv.title;
        titleSpan.addEventListener('click', () => this.loadConversation(conv.id));
        
        // Create delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'conversation-delete';
        deleteBtn.innerHTML = '&times;';  // HTML entity for multiplication sign
        deleteBtn.title = 'Delete conversation';
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteConversation(conv.id);
        });
        
        item.appendChild(titleSpan);
        item.appendChild(deleteBtn);
        
        conversationsContainer.appendChild(item);
      });
      
      // Append the conversations container after the header
      targetContainer.appendChild(conversationsContainer);
      
      // Add spacing between groups
      if (sites.indexOf(site) < sites.length - 1) {
        const spacer = document.createElement('div');
        spacer.style.cssText = 'height: 8px;';
        targetContainer.appendChild(spacer);
      }
    });
  }
  
  async loadConversations() {
    // Check if user is logged in
    const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
    const authToken = localStorage.getItem('authToken');
    
    if (authToken && userInfo && (userInfo.id || userInfo.email)) {
      // User is logged in, load conversations from server
      try {
        const userId = userInfo.id || userInfo.email;
        const site = this.selectedSite;
        const baseUrl = window.location.origin === 'file://' ? 'http://localhost:8000' : '';
        const url = `${baseUrl}/api/conversations?user_id=${encodeURIComponent(userId)}&site=${encodeURIComponent(site)}&limit=50`;
        
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          
          // Convert server conversations to our format
          this.conversations = this.convertServerConversations(data.conversations);
          
          // Also check localStorage for any unsaved conversations
          this.mergeLocalConversations();
          
          // Update the UI
          this.updateConversationsList();
          
          console.log('Loaded', this.conversations.length, 'conversations from server');
        } else {
          console.error('Failed to load conversations from server:', response.status);
          // Fall back to localStorage
          this.loadLocalConversations();
        }
      } catch (error) {
        console.error('Error loading conversations from server:', error);
        // Fall back to localStorage
        this.loadLocalConversations();
      }
    } else {
      // User not logged in, use localStorage only
      this.loadLocalConversations();
    }
  }
  
  loadLocalConversations() {
    const saved = localStorage.getItem('nlweb-modern-conversations');
    if (saved) {
      try {
        const allConversations = JSON.parse(saved);
        // Filter out empty conversations
        let filteredConversations = allConversations.filter(conv => conv.messages && conv.messages.length > 0);
        
        // If a specific site is selected, filter by site
        if (this.selectedSite && this.selectedSite !== 'all') {
          filteredConversations = filteredConversations.filter(conv => 
            conv.site === this.selectedSite || 
            (conv.siteInfo && conv.siteInfo.site === this.selectedSite)
          );
        }
        
        this.conversations = filteredConversations;
        // Save the cleaned list back
        this.saveConversations();
      } catch (e) {
        console.error('Error loading conversations:', e);
        this.conversations = [];
      }
    }
  }
  
  convertServerConversations(serverConversations) {
    // Convert server format to local format
    // Server returns flat array of ConversationEntry objects
    const conversationMap = new Map();
    
    // Group conversations by thread_id
    serverConversations.forEach(entry => {
      const threadId = entry.thread_id;
      if (!conversationMap.has(threadId)) {
        conversationMap.set(threadId, {
          id: threadId,
          title: '',
          timestamp: 0,
          site: entry.site,
          siteInfo: {
            site: entry.site,
            mode: 'list'
          },
          messages: []
        });
      }
      
      const conversation = conversationMap.get(threadId);
      const timestamp = new Date(entry.timestamp).getTime();
      
      // Add user message
      conversation.messages.push({
        content: entry.user_prompt,
        type: 'user',
        timestamp: timestamp
      });
      
      // Add assistant message
      conversation.messages.push({
        content: entry.response,
        type: 'assistant',
        timestamp: timestamp + 1
      });
      
      // Update conversation timestamp to latest message
      if (timestamp > conversation.timestamp) {
        conversation.timestamp = timestamp;
      }
      
      // Set title from first user prompt if not set
      if (!conversation.title && entry.user_prompt) {
        conversation.title = entry.user_prompt.substring(0, 50) + 
                           (entry.user_prompt.length > 50 ? '...' : '');
      }
    });
    
    // Convert map to array and sort by timestamp
    const convertedConversations = Array.from(conversationMap.values());
    return convertedConversations.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  mergeLocalConversations() {
    // Check if there are any conversations in localStorage that aren't on the server
    const saved = localStorage.getItem('nlweb-modern-conversations');
    if (saved) {
      try {
        const localConversations = JSON.parse(saved);
        const serverIds = new Set(this.conversations.map(c => c.id));
        
        // Add any local conversations that aren't on the server
        localConversations.forEach(localConv => {
          if (!serverIds.has(localConv.id) && localConv.messages && localConv.messages.length > 0) {
            // Check site filter
            const convSite = localConv.site || (localConv.siteInfo && localConv.siteInfo.site) || 'all';
            if (this.selectedSite === 'all' || convSite === this.selectedSite) {
              this.conversations.push(localConv);
            }
          }
        });
        
        // Sort by timestamp
        this.conversations.sort((a, b) => b.timestamp - a.timestamp);
      } catch (e) {
        console.error('Error merging local conversations:', e);
      }
    }
  }
  
  async migrateLocalConversations() {
    // Migrate local conversations to server when user logs in
    const saved = localStorage.getItem('nlweb-modern-conversations');
    if (!saved) return;
    
    try {
      const localConversations = JSON.parse(saved);
      if (!localConversations || localConversations.length === 0) return;
      
      const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
      const authToken = localStorage.getItem('authToken');
      const userId = userInfo.id || userInfo.email;
      
      if (!userId || !authToken) return;
      
      // Convert local conversations to server format
      const conversationsToMigrate = [];
      
      localConversations.forEach(conv => {
        if (!conv.messages || conv.messages.length === 0) return;
        
        // Convert to server format - extract user/assistant message pairs
        for (let i = 0; i < conv.messages.length - 1; i += 2) {
          const userMsg = conv.messages[i];
          const assistantMsg = conv.messages[i + 1];
          
          if (userMsg.type === 'user' && assistantMsg && assistantMsg.type === 'assistant') {
            conversationsToMigrate.push({
              thread_id: conv.id,
              user_prompt: userMsg.content,
              response: assistantMsg.content,
              site: conv.site || conv.siteInfo?.site || 'all',
              timestamp: new Date(userMsg.timestamp).toISOString()
            });
          }
        }
      });
      
      if (conversationsToMigrate.length === 0) return;
      
      // Send to server
      const baseUrl = window.location.origin === 'file://' ? 'http://localhost:8000' : '';
      const response = await fetch(`${baseUrl}/api/conversations/migrate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          user_id: userId,
          conversations: conversationsToMigrate
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log(`Successfully migrated ${result.migrated_count} conversations to server`);
        
        // Clear localStorage after successful migration
        localStorage.removeItem('nlweb-modern-conversations');
      } else {
        console.error('Failed to migrate conversations:', response.status);
      }
    } catch (error) {
      console.error('Error migrating conversations:', error);
    }
  }
  
  deleteConversation(conversationId) {
    // Remove from conversations array
    this.conversations = this.conversations.filter(conv => conv.id !== conversationId);
    
    // Save updated list
    this.saveConversations();
    
    // Update UI
    this.updateConversationsList();
    
    // If we deleted the current conversation, create a new one
    if (conversationId === this.currentConversationId) {
      this.createNewChat();
    }
  }
  
  saveConversations() {
    // Only save conversations that have messages
    const conversationsToSave = this.conversations.filter(conv => conv.messages && conv.messages.length > 0);
    localStorage.setItem('nlweb-modern-conversations', JSON.stringify(conversationsToSave));
  }
  
  scrollToBottom() {
    this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
  }
  
  scrollToUserMessage() {
    // Find the last user message
    const userMessages = this.elements.messagesContainer.querySelectorAll('.user-message');
    if (userMessages.length > 0) {
      const lastUserMessage = userMessages[userMessages.length - 1];
      
      // Always scroll to put the user message at the top of the viewport
      // This ensures consistent positioning for follow-up queries
      lastUserMessage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      
      // Add a small offset from the top (e.g., 20px padding)
      setTimeout(() => {
        this.elements.chatMessages.scrollTop -= 20;
      }, 100);
    }
  }
  
  showCenteredInput() {
    console.log('showCenteredInput called');
    // Remove any existing centered input first
    const existingCentered = document.querySelector('.centered-input-container');
    if (existingCentered) {
      existingCentered.remove();
    }
    
    // Hide the normal chat input area
    const chatInputContainer = document.querySelector('.chat-input-container');
    if (chatInputContainer) {
      chatInputContainer.style.display = 'none';
    }
    
    // Create centered input container
    const centeredContainer = document.createElement('div');
    centeredContainer.className = 'centered-input-container';
    centeredContainer.innerHTML = `
      <div class="centered-input-wrapper">
        <div class="centered-input-box">
          <div class="input-box-top-row">
            <textarea 
              class="centered-chat-input" 
              id="centered-chat-input"
              placeholder="Ask"
              rows="2"
            ></textarea>
            <button class="centered-send-button" id="centered-send-button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
          <div class="input-box-bottom-row">
            <div class="input-site-selector">
              <button class="site-selector-icon" id="site-selector-icon" title="Select site">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
              </button>
              <div class="site-dropdown" id="site-dropdown">
                <div class="site-dropdown-header">Select site</div>
                <div id="site-dropdown-items">
                  <!-- Sites will be added here -->
                </div>
              </div>
            </div>
            <div class="input-mode-selector">
              <button class="mode-selector-icon" id="centered-mode-selector-icon" title="Select mode">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="9" y1="9" x2="15" y2="9"></line>
                  <line x1="9" y1="12" x2="15" y2="12"></line>
                  <line x1="9" y1="15" x2="11" y2="15"></line>
                </svg>
              </button>
              <div class="mode-dropdown" id="centered-mode-dropdown">
                <div class="mode-dropdown-item" data-mode="list">List</div>
                <div class="mode-dropdown-item" data-mode="summarize">Summarize</div>
                <div class="mode-dropdown-item" data-mode="generate">Generate</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Add to messages area
    this.elements.messagesContainer.appendChild(centeredContainer);
    
    // Store references
    this.centeredInput = document.getElementById('centered-chat-input');
    this.centeredSendButton = document.getElementById('centered-send-button');
    this.siteSelectorIcon = document.getElementById('site-selector-icon');
    this.siteDropdown = document.getElementById('site-dropdown');
    this.siteDropdownItems = document.getElementById('site-dropdown-items');
    
    // Bind events for centered input
    this.centeredSendButton.addEventListener('click', () => this.sendFromCenteredInput());
    
    // Site selector events
    this.siteSelectorIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSiteDropdown();
    });
    
    // Mode selector events for centered input
    const centeredModeSelectorIcon = document.getElementById('centered-mode-selector-icon');
    const centeredModeDropdown = document.getElementById('centered-mode-dropdown');
    
    if (centeredModeSelectorIcon && centeredModeDropdown) {
      centeredModeSelectorIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        centeredModeDropdown.classList.toggle('show');
      });
      
      // Mode selection
      const modeItems = centeredModeDropdown.querySelectorAll('.mode-dropdown-item');
      modeItems.forEach(item => {
        item.addEventListener('click', () => {
          const mode = item.getAttribute('data-mode');
          this.selectedMode = mode;
          
          // Update UI
          modeItems.forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          centeredModeDropdown.classList.remove('show');
          
          // Update icon title
          centeredModeSelectorIcon.title = `Mode: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`;
        });
      });
      
      // Set initial selection
      const initialItem = centeredModeDropdown.querySelector(`[data-mode="${this.selectedMode}"]`);
      if (initialItem) {
        initialItem.classList.add('selected');
      }
      centeredModeSelectorIcon.title = `Mode: ${this.selectedMode.charAt(0).toUpperCase() + this.selectedMode.slice(1)}`;
    }
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.siteDropdown.contains(e.target) && !this.siteSelectorIcon.contains(e.target)) {
        this.siteDropdown.classList.remove('show');
      }
      if (centeredModeDropdown && !e.target.closest('.input-mode-selector')) {
        centeredModeDropdown.classList.remove('show');
      }
    });
    
    this.centeredInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendFromCenteredInput();
      }
    });
    
    // Auto-resize centered textarea
    this.centeredInput.addEventListener('input', () => {
      this.centeredInput.style.height = 'auto';
      this.centeredInput.style.height = Math.min(this.centeredInput.scrollHeight, 150) + 'px';
    });
    
    // Focus the input
    this.centeredInput.focus();
  }
  
  hideCenteredInput() {
    const centeredContainer = document.querySelector('.centered-input-container');
    if (centeredContainer) {
      centeredContainer.remove();
    }
    
    // Show the normal chat input area
    const chatInputContainer = document.querySelector('.chat-input-container');
    if (chatInputContainer) {
      chatInputContainer.style.display = '';
    }
  }
  
  sendFromCenteredInput() {
    const message = this.centeredInput.value.trim();
    if (!message) return;
    
    // Hide centered input
    this.hideCenteredInput();
    
    // Send the message using the normal flow
    this.sendMessage(message);
  }
  
  
  toggleDebugInfo() {
    // Find the last assistant message
    const assistantMessages = this.elements.messagesContainer.querySelectorAll('.assistant-message');
    if (assistantMessages.length === 0) return;
    
    const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
    const messageContent = lastAssistantMessage.querySelector('.message-content');
    const messageText = lastAssistantMessage.querySelector('.message-text');
    
    if (!messageContent || !messageText) return;
    
    // Check if we're currently showing debug info
    const isShowingDebug = messageText.classList.contains('showing-debug');
    
    if (isShowingDebug) {
      // Restore original HTML content
      const originalContent = messageText.getAttribute('data-original-content');
      if (originalContent) {
        messageText.textContent = originalContent;
        messageText.classList.remove('showing-debug');
        messageText.style.cssText = ''; // Reset inline styles
      }
    } else {
      // Store original content and show debug info
      messageText.setAttribute('data-original-content', messageText.innerHTML);
      messageText.classList.add('showing-debug');
      
      // Create pretty formatted debug content
      const debugHtml = this.createDebugString();
      
      // Replace content with debug info
      messageText.innerHTML = debugHtml;
    }
  }
  
  createDebugString() {
    let debugHtml = '<div style="font-family: ui-monospace, SFMono-Regular, \'SF Mono\', Consolas, \'Liberation Mono\', Menlo, monospace; font-size: 13px; line-height: 1.5;">';
    
    // MCP-style header
    debugHtml += '<div style="background: #f6f8fa; border: 1px solid #d1d9e0; border-radius: 6px; padding: 12px; margin-bottom: 16px;">';
    debugHtml += '<div style="color: #57606a; font-weight: 600; margin-bottom: 4px;">Debug Information</div>';
    debugHtml += `<div style="color: #6e7781; font-size: 12px;">Messages: ${this.debugMessages ? this.debugMessages.length : 0}</div>`;
    debugHtml += '</div>';
    
    // Add debug messages in MCP style
    if (this.debugMessages && this.debugMessages.length > 0) {
      for (const msg of this.debugMessages) {
        // Message type header
        debugHtml += '<div style="margin-bottom: 12px;">';
        debugHtml += '<div style="background: #ddf4ff; border: 1px solid #54aeff; border-radius: 6px 6px 0 0; padding: 8px 12px; font-weight: 600; color: #0969da;">';
        debugHtml += `${this.escapeHtml(msg.type || 'unknown')}`;
        if (msg.timestamp) {
          debugHtml += `<span style="float: right; font-weight: normal; font-size: 11px; color: #57606a;">${new Date(msg.timestamp).toLocaleTimeString()}</span>`;
        }
        debugHtml += '</div>';
        
        // Message content
        debugHtml += '<div style="background: #ffffff; border: 1px solid #d1d9e0; border-top: none; border-radius: 0 0 6px 6px; padding: 12px;">';
        debugHtml += '<pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word; color: #1f2328; font-size: 12px;">';
        debugHtml += this.formatDebugData(msg.data);
        debugHtml += '</pre>';
        debugHtml += '</div>';
        debugHtml += '</div>';
      }
    }
    
    // Add current results if available
    if (this.currentStreamingMessage && this.currentStreamingMessage.allResults && this.currentStreamingMessage.allResults.length > 0) {
      debugHtml += '<div style="margin-top: 24px;">';
      debugHtml += '<div style="background: #fff8c5; border: 1px solid #d4a72c; border-radius: 6px 6px 0 0; padding: 8px 12px; font-weight: 600; color: #7d4e00;">';
      debugHtml += `Result Items (${this.currentStreamingMessage.allResults.length})`;
      debugHtml += '</div>';
      debugHtml += '<div style="background: #ffffff; border: 1px solid #d1d9e0; border-top: none; border-radius: 0 0 6px 6px; padding: 12px;">';
      debugHtml += '<pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word; color: #1f2328; font-size: 12px;">';
      debugHtml += this.formatDebugData(this.currentStreamingMessage.allResults);
      debugHtml += '</pre>';
      debugHtml += '</div>';
      debugHtml += '</div>';
    }
    
    debugHtml += '</div>';
    return debugHtml;
  }
  
  formatDebugData(data) {
    // Handle collapsible schema_objects
    const createCollapsibleHtml = (obj, depth = 0) => {
      if (typeof obj !== 'object' || obj === null) {
        return this.escapeHtml(JSON.stringify(obj));
      }
      
      if (Array.isArray(obj)) {
        let html = '[\n';
        obj.forEach((item, index) => {
          const indent = '  '.repeat(depth + 1);
          html += indent + createCollapsibleHtml(item, depth + 1);
          if (index < obj.length - 1) html += ',';
          html += '\n';
        });
        html += '  '.repeat(depth) + ']';
        return html;
      }
      
      let html = '{\n';
      const entries = Object.entries(obj);
      entries.forEach(([key, value], index) => {
        const indent = '  '.repeat(depth + 1);
        html += indent + '"' + this.escapeHtml(key) + '": ';
        
        if (key === 'schema_object' && value) {
          // Create collapsible section for schema_object
          const buttonId = `schema-toggle-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const contentId = `schema-content-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          
          html += `<span style="color: #0969da; cursor: pointer;" onclick="
            var btn = document.getElementById('${buttonId}');
            var content = document.getElementById('${contentId}');
            if (content.style.display === 'none') {
              content.style.display = 'inline';
              btn.textContent = '[-]';
            } else {
              content.style.display = 'none';
              btn.textContent = '[+]';
            }
          "><span id="${buttonId}" style="font-weight: bold;">[+]</span></span><span id="${contentId}" style="display: none;">`;
          
          // Pretty print the schema object
          html += '\n' + indent + JSON.stringify(value, null, 2).split('\n').join('\n' + indent);
          html += '</span>';
        } else {
          html += createCollapsibleHtml(value, depth + 1);
        }
        
        if (index < entries.length - 1) html += ',';
        html += '\n';
      });
      html += '  '.repeat(depth) + '}';
      return html;
    };
    
    return createCollapsibleHtml(data);
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  toggleSiteDropdown() {
    this.siteDropdown.classList.toggle('show');
    if (this.siteDropdown.classList.contains('show')) {
      this.populateSiteDropdown();
    }
  }
  
  populateSiteDropdown() {
    if (!this.sites || this.sites.length === 0) return;
    
    this.siteDropdownItems.innerHTML = '';
    this.sites.forEach(site => {
      const item = document.createElement('div');
      item.className = 'site-dropdown-item';
      if (site === this.selectedSite) {
        item.classList.add('selected');
      }
      item.textContent = site;
      item.addEventListener('click', () => {
        this.selectedSite = site;
        this.siteDropdown.classList.remove('show');
        this.populateSiteDropdown(); // Update selection
        
        // Update icon title to show selected site
        this.siteSelectorIcon.title = `Site: ${site}`;
        
        // Update the header site info
        if (this.elements.chatSiteInfo) {
          this.elements.chatSiteInfo.textContent = `Asking ${site}`;
        }
        
        // Update the current conversation's site if it exists
        const conversation = this.conversations.find(c => c.id === this.currentConversationId);
        if (conversation) {
          conversation.site = site;
          this.saveConversations();
        }
      });
      this.siteDropdownItems.appendChild(item);
    });
  }
  
  
  addRememberedItem(item) {
    if (!item || this.rememberedItems.includes(item)) return;
    
    this.rememberedItems.push(item);
    this.saveRememberedItems();
    this.updateRememberedItemsList();
  }
  
  deleteRememberedItem(item) {
    this.rememberedItems = this.rememberedItems.filter(i => i !== item);
    this.saveRememberedItems();
    this.updateRememberedItemsList();
  }
  
  saveRememberedItems() {
    localStorage.setItem('nlweb-remembered-items', JSON.stringify(this.rememberedItems));
  }
  
  loadRememberedItems() {
    const saved = localStorage.getItem('nlweb-remembered-items');
    if (saved) {
      try {
        this.rememberedItems = JSON.parse(saved);
      } catch (e) {
        console.error('Error loading remembered items:', e);
        this.rememberedItems = [];
      }
    }
  }
  
  updateRememberedItemsList() {
    // Find or create remembered section
    let rememberedSection = document.getElementById('remembered-section');
    if (!rememberedSection && this.rememberedItems.length > 0) {
      // Create remembered section
      rememberedSection = document.createElement('div');
      rememberedSection.id = 'remembered-section';
      // CSS is now handled in the stylesheet
      
      const header = document.createElement('h3');
      header.textContent = 'Remembered';
      header.style.cssText = 'font-size: 14px; font-weight: 600; color: var(--text-secondary); margin-bottom: 12px;';
      rememberedSection.appendChild(header);
      
      const itemsList = document.createElement('div');
      itemsList.id = 'remembered-items-list';
      rememberedSection.appendChild(itemsList);
      
      // Insert after conversations list in the sidebar
      const sidebar = this.elements.sidebar;
      const conversationsList = this.elements.conversationsList;
      // Insert after conversations list, not inside it
      conversationsList.parentNode.insertBefore(rememberedSection, conversationsList.nextSibling);
    } else if (rememberedSection && this.rememberedItems.length === 0) {
      // Remove section if no items
      rememberedSection.remove();
      return;
    }
    
    // Update items list
    const itemsList = document.getElementById('remembered-items-list');
    if (itemsList) {
      itemsList.innerHTML = '';
      
      this.rememberedItems.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'remembered-item';
        itemDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; margin-bottom: 4px; background-color: var(--bg-secondary); border-radius: 6px; font-size: 13px; color: var(--text-primary); transition: background-color 0.2s ease;';
        
        const itemText = document.createElement('span');
        itemText.textContent = item;
        itemText.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
        itemText.title = item; // Add full text as tooltip
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'remembered-item-delete';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.style.cssText = 'border: none; background: none; color: var(--text-secondary); font-size: 18px; cursor: pointer; padding: 0; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s ease;';
        deleteBtn.title = 'Delete remembered item';
        deleteBtn.addEventListener('click', () => this.deleteRememberedItem(item));
        
        // Add hover effect
        itemDiv.addEventListener('mouseenter', () => {
          itemDiv.style.backgroundColor = 'var(--hover-bg)';
          deleteBtn.style.opacity = '0.7';
        });
        
        itemDiv.addEventListener('mouseleave', () => {
          itemDiv.style.backgroundColor = 'var(--bg-secondary)';
          deleteBtn.style.opacity = '0';
        });
        
        // Make delete button fully visible on hover
        deleteBtn.addEventListener('mouseenter', () => {
          deleteBtn.style.opacity = '1';
        });
        
        itemDiv.appendChild(itemText);
        itemDiv.appendChild(deleteBtn);
        itemsList.appendChild(itemDiv);
      });
    }
  }
  
  async loadSites() {
    try {
      const baseUrl = window.location.origin === 'file://' ? 'http://localhost:8000' : '';
      const response = await fetch(`${baseUrl}/sites?streaming=false`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data && data['message-type'] === 'sites' && Array.isArray(data.sites)) {
        let sites = data.sites;
        
        // Sort sites alphabetically
        sites.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        
        // Add 'all' to the beginning if not present
        if (!sites.includes('all')) {
          sites.unshift('all');
        } else {
          sites = sites.filter(site => site !== 'all');
          sites.unshift('all');
        }
        
        // Store sites
        this.sites = sites;
        this.selectedSite = 'all';
        
        // Update site selector icon if it exists
        if (this.siteSelectorIcon) {
          this.siteSelectorIcon.title = `Site: ${this.selectedSite}`;
        }
        
        // Update the header site info
        if (this.elements.chatSiteInfo) {
          this.elements.chatSiteInfo.textContent = `Asking ${this.selectedSite}`;
        }
      }
    } catch (error) {
      console.error('Error loading sites:', error);
      
      // Fallback sites
      const fallbackSites = ['all', 'eventbrite', 'oreilly', 'scifi_movies', 'verge'];
      this.sites = fallbackSites;
      this.selectedSite = 'all';
      
      // Update site selector icon if it exists
      if (this.siteSelectorIcon) {
        this.siteSelectorIcon.title = `Site: ${this.selectedSite}`;
      }
      
      // Update the header site info
      if (this.elements.chatSiteInfo) {
        this.elements.chatSiteInfo.textContent = `Site: ${this.selectedSite}`;
      }
    }
  }
}

// Export the class for use in other modules
export { ModernChatInterface };

// Initialize when DOM is ready (only if not imported as module)
if (typeof window !== 'undefined' && !window.ModernChatInterfaceExported) {
  document.addEventListener('DOMContentLoaded', () => {
    new ModernChatInterface();
  });
  window.ModernChatInterfaceExported = true;
}