# Sharp Eye

A Chrome extension that uses AI to critically analyze web content, identifying assumptions, logical fallacies, contradictions, and fluff.

![Sharp Eye Icon](icons/icon128.png)

## Features

- **Critical Analysis**: Identifies hidden assumptions, logical fallacies, contradictions, and marketing fluff in any web page
- **Visual Highlights**: Highlights problematic content directly on the page with color-coded overlays
- **Side Panel UI**: Clean, minimal interface that doesn't interfere with your browsing
- **Structured Output**: Uses OpenAI's structured outputs for reliable, consistent analysis
- **Persistent Results**: Analysis results are cached per URL for quick reference

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the extension folder

## Setup

1. Click the Sharp Eye icon in your browser toolbar
2. Click the settings button and enter your OpenAI API key
3. Navigate to any web page and click "Analyze"

## What It Looks For

| Type | Symbol | Description |
|------|--------|-------------|
| Assumptions | `[A]` | Unstated premises taken for granted |
| Fallacies | `[F]` | Flawed reasoning or logical errors |
| Contradictions | `[C]` | Inconsistent or conflicting statements |
| Fluff | `[~]` | Vague marketing speak or filler content |

## Tech Stack

- Chrome Extension (Manifest V3)
- OpenAI API with structured outputs (JSON schema)
- Vanilla JavaScript (no framework dependencies)

## Requirements

- Chrome browser (or Chromium-based browser)
- OpenAI API key

## License

MIT
