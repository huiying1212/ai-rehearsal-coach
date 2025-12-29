/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { useEffect, useState } from "react";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import {
  FunctionDeclaration,
  LiveServerToolCall,
  Type,
} from "@google/genai";
import "./whiteboard.scss";

export const displayContentDeclaration: FunctionDeclaration = {
  name: "display_content",
  description: `Displays CONCISE content on the whiteboard. CRITICAL RULES:
- Content must be SHORT and FIT ON ONE SCREEN without scrolling
- For type="text": content must be 1-3 sentences MAX (under 100 words)
- For type="list": items array must have 3-5 items MAX, each item under 15 words
- Titles should be under 8 words
- Focus on KEY POINTS only, not detailed explanations (save details for verbal explanation)`,
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: "Short title (under 8 words)",
      },
      content: {
        type: Type.STRING,
        description: "REQUIRED for type='text': Brief summary in 1-3 sentences (under 100 words). Must not be empty.",
      },
      type: {
        type: Type.STRING,
        description: "Content type",
        enum: ["text", "list", "images"],
      },
      items: {
        type: Type.ARRAY,
        description: "REQUIRED for type='list': 3-5 bullet points, each under 15 words",
        items: {
          type: Type.STRING,
        },
      },
      images: {
        type: Type.ARRAY,
        description: "Array of image objects from RAG results",
        items: {
          type: Type.OBJECT,
          properties: {
            url: {
              type: Type.STRING,
              description: "URL of the image",
            },
            description: {
              type: Type.STRING,
              description: "Brief description (under 10 words)",
            },
            chapter: {
              type: Type.STRING,
              description: "Source chapter",
            },
          },
        },
      },
    },
    required: ["title", "type"],
  },
};

interface WhiteboardContent {
  title: string;
  content: string;
  type: "text" | "list" | "images";
  items?: string[];
  images?: {
    url: string;
    description: string;
    chapter: string;
  }[];
  timestamp: number;
}

export function Whiteboard() {
  const { client } = useLiveAPIContext();
  const [slides, setSlides] = useState<WhiteboardContent[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(-1);

  const content =
    currentSlideIndex >= 0 && currentSlideIndex < slides.length
      ? slides[currentSlideIndex]
      : null;

  // Notify parent component about whiteboard content state
  useEffect(() => {
    const hasContent = content !== null;
    // Dispatch custom event to notify App component
    window.dispatchEvent(new CustomEvent('whiteboardContentChange', { 
      detail: { hasContent } 
    }));
  }, [content]);

  useEffect(() => {
    const onToolCall = (toolCall: LiveServerToolCall) => {
      if (!toolCall.functionCalls) {
        return;
      }

      const displayCalls = toolCall.functionCalls.filter(
        (fc) => fc.name === displayContentDeclaration.name
      );

      if (displayCalls.length === 0) {
        return;
      }

      const responses: any[] = [];

      for (const fc of displayCalls) {
        const args = fc.args as any;
        console.log("Displaying content on whiteboard:", args);

        const newContent: WhiteboardContent = {
          title: args.title || "",
          content: args.content || "",
          type: args.type || "text",
          items: args.items,
          images: args.images,
          timestamp: Date.now(),
        };

        // Add new slide to history
        setSlides((prevSlides) => [...prevSlides, newContent]);

        responses.push({
          response: { output: { success: true } },
          id: fc.id,
          name: fc.name,
        });
      }

      // Send responses for display calls
      if (responses.length > 0) {
        setTimeout(
          () =>
            client.sendToolResponse({
              functionResponses: responses,
            }),
          200
        );
      }
    };

    client.on("toolcall", onToolCall);
    return () => {
      client.off("toolcall", onToolCall);
    };
  }, [client]);

  // Auto-navigate to the latest slide when new content is added
  useEffect(() => {
    if (slides.length > 0) {
      setCurrentSlideIndex(slides.length - 1);
    }
  }, [slides.length]);

  const handlePreviousSlide = () => {
    if (currentSlideIndex > 0) {
      setCurrentSlideIndex(currentSlideIndex - 1);
    }
  };

  const handleNextSlide = () => {
    if (currentSlideIndex < slides.length - 1) {
      setCurrentSlideIndex(currentSlideIndex + 1);
    }
  };

  const handleSlideSelect = (index: number) => {
    setCurrentSlideIndex(index);
  };

  const renderNavigationControls = () => {
    const isEmpty = slides.length === 0;

    return (
      <div className="whiteboard-nav">
        <button
          onClick={handlePreviousSlide}
          disabled={isEmpty || currentSlideIndex <= 0}
          className="nav-button"
        >
          ‹ Previous
        </button>

        {isEmpty ? (
          <div className="slide-selector empty">No slides yet</div>
        ) : (
          <select
            value={currentSlideIndex}
            onChange={(e) => handleSlideSelect(Number(e.target.value))}
            className="slide-selector"
          >
            {slides.map((slide, index) => (
              <option key={index} value={index}>
                {index + 1}. {slide.title.substring(0, 30)}
                {slide.title.length > 30 ? "..." : ""}
              </option>
            ))}
          </select>
        )}

        <button
          onClick={handleNextSlide}
          disabled={isEmpty || currentSlideIndex >= slides.length - 1}
          className="nav-button"
        >
          Next ›
        </button>

        <div className="slide-counter">
          {isEmpty ? "0 / 0" : `${currentSlideIndex + 1} / ${slides.length}`}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (!content) {
      return (
        <div className="whiteboard-empty">
          <div className="empty-content">
            <div className="empty-icon">📚</div>
            <div className="empty-title">Knowledge Whiteboard</div>
            <div className="empty-text">
              RAG-retrieved content will appear here
            </div>
          </div>
        </div>
      );
    }

    if (content.type === "images") {
      const imageCount = content.images?.length || 0;

      return (
        <div className="whiteboard-content images">
          <div className="content-header">
            <h2>{content.title}</h2>
            {content.content && <div className="subtitle">{content.content}</div>}
          </div>

          <div className="images-container">
            {content.images?.slice(0, 4).map((image, index) => (
              <div key={index} className="image-card">
                <div className="image-wrapper">
                  <img
                    src={image.url}
                    alt={image.description}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                      const parent = (e.target as HTMLElement).parentElement;
                      if (parent) {
                        parent.innerHTML =
                          '<div class="image-error">🖼️<br/>Image unavailable</div>';
                      }
                    }}
                  />
                </div>
                <div className="image-info">
                  <div className="image-description">{image.description}</div>
                  <div className="image-source">Source: {image.chapter}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (content.type === "list") {
      const itemsToShow = content.items || [];
      const hasImages = content.images && content.images.length > 0;

      return (
        <div className="whiteboard-content list">
          <div className="content-header">
            <h2>{content.title}</h2>
          </div>

          <div className={hasImages ? "split-layout" : "single-layout"}>
            <div className="list-container">
              {itemsToShow.slice(0, 6).map((item, index) => (
                <div key={index} className="list-item">
                  <div className="item-number">{index + 1}</div>
                  <div className="item-text">{item}</div>
                </div>
              ))}
            </div>

            {hasImages && (
              <div className="images-sidebar">
                {content.images?.slice(0, 2).map((image, index) => (
                  <div key={index} className="sidebar-image">
                    <img src={image.url} alt={image.description} />
                    <div className="sidebar-caption">{image.description}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Default: text type
    const hasImages = content.images && content.images.length > 0;

    return (
      <div className="whiteboard-content text">
        <div className="content-header">
          <h2>{content.title}</h2>
        </div>

        <div className={hasImages ? "split-layout" : "single-layout"}>
          <div className="text-container">
            <div className="text-content">{content.content}</div>
          </div>

          {hasImages && (
            <div className="images-sidebar">
              {content.images?.slice(0, 2).map((image, index) => (
                <div key={index} className="sidebar-image">
                  <img src={image.url} alt={image.description} />
                  <div className="sidebar-caption">{image.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="whiteboard-wrapper">
      {renderNavigationControls()}
      <div className="whiteboard-display">{renderContent()}</div>
    </div>
  );
}

