import React from 'react';
import { SlideDesign } from '../types';
import './SlideRenderer.scss';

interface SlideRendererProps {
  slide: SlideDesign | null;
  className?: string;
}

/**
 * SlideRenderer component - renders a single slide based on SlideDesign
 * Adapted from the whiteboard project's rendering logic
 */
const SlideRenderer: React.FC<SlideRendererProps> = ({ slide, className = '' }) => {
  if (!slide) {
    return (
      <div className={`slide-renderer slide-empty ${className}`}>
        <div className="empty-content">
          <div className="empty-icon">📊</div>
          <div className="empty-title">Presentation Slide</div>
          <div className="empty-text">Slide content will appear here</div>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    switch (slide.type) {
      case 'list':
        return (
          <div className="slide-body list-layout">
            <div className="list-container">
              {slide.items?.slice(0, 6).map((item, index) => (
                <div key={index} className="list-item">
                  <div className="item-number">{index + 1}</div>
                  <div className="item-text">{item}</div>
                </div>
              ))}
            </div>
          </div>
        );

      case 'images':
        return (
          <div className="slide-body images-layout">
            {slide.images?.slice(0, 4).map((image, index) => (
              <div key={index} className="image-card">
                <div className="image-wrapper">
                  <img
                    src={image.url}
                    alt={image.description}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      const parent = (e.target as HTMLElement).parentElement;
                      if (parent) {
                        parent.innerHTML = '<div class="image-error">🖼️<br/>Image unavailable</div>';
                      }
                    }}
                  />
                </div>
                <div className="image-caption">{image.description}</div>
              </div>
            ))}
          </div>
        );

      case 'text':
      default:
        return (
          <div className="slide-body text-layout">
            <div className="text-content">{slide.content || ''}</div>
          </div>
        );
    }
  };

  return (
    <div className={`slide-renderer ${className}`}>
      <div className="slide-header">
        <h2 className="slide-title">{slide.title}</h2>
      </div>
      {renderContent()}
    </div>
  );
};

export default SlideRenderer;

