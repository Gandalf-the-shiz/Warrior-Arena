import type { WeatherState } from '@/game/WeatherSystem';

const WEATHER_ICONS: Record<WeatherState, string> = {
  CLEAR:      '☀️ Clear',
  FOG:        '🌫️ Dense Fog',
  BLOOD_MOON: '🩸 Blood Moon',
  STORM:      '🌧️ Storm',
};

/**
 * Displays the current weather state below the wave counter (top-center).
 */
export class WeatherHUD {
  private readonly el: HTMLElement;
  private displayed: WeatherState = 'CLEAR';

  constructor() {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      top: '80px',
      left: '50%',
      transform: 'translateX(-50%)',
      fontFamily: "'Palatino Linotype', Georgia, serif",
      fontSize: '14px',
      letterSpacing: '0.1em',
      color: '#e8d5a0',
      textShadow: '0 0 8px rgba(0,0,0,0.9)',
      pointerEvents: 'none',
      zIndex: '20',
      opacity: '0',
      transition: 'opacity 0.5s',
    });
    document.body.appendChild(this.el);
  }

  update(state: WeatherState): void {
    if (state !== this.displayed) {
      this.displayed = state;
      this.el.textContent = WEATHER_ICONS[state];
      // Show only when non-clear
      this.el.style.opacity = state === 'CLEAR' ? '0' : '1';
    }
  }
}
