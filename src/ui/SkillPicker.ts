import { SkillSystem, SkillDefinition, RARITY_COLORS, SkillRarity } from '@/game/SkillSystem';

/**
 * Between-wave skill selection modal UI.
 * Pauses the game loop, shows 3 random skill cards, waits for selection,
 * applies chosen skill, then resumes.
 */
export class SkillPicker {
  private readonly overlay: HTMLElement;
  private readonly cardContainer: HTMLElement;
  private readonly titleEl: HTMLElement;
  private resolveSelection: (() => void) | null = null;

  constructor() {
    // ── Overlay ──────────────────────────────────────────────────────────────
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(5,5,10,0.88)',
      zIndex: '60',
      pointerEvents: 'auto',
      fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif",
    });

    // ── Title ────────────────────────────────────────────────────────────────
    this.titleEl = document.createElement('div');
    Object.assign(this.titleEl.style, {
      fontSize: '28px',
      fontWeight: 'bold',
      letterSpacing: '0.25em',
      color: '#e8d5a0',
      textShadow: '0 0 24px rgba(232,213,160,0.6)',
      marginBottom: '12px',
      textTransform: 'uppercase',
    });
    this.titleEl.textContent = 'Choose Your Path';

    const subtitle = document.createElement('div');
    Object.assign(subtitle.style, {
      fontSize: '13px',
      letterSpacing: '0.2em',
      color: '#888',
      marginBottom: '32px',
      textTransform: 'uppercase',
    });
    subtitle.textContent = 'Select one skill to carry into battle';

    // ── Card container ────────────────────────────────────────────────────────
    this.cardContainer = document.createElement('div');
    Object.assign(this.cardContainer.style, {
      display: 'flex',
      gap: '24px',
      alignItems: 'stretch',
    });

    this.overlay.appendChild(this.titleEl);
    this.overlay.appendChild(subtitle);
    this.overlay.appendChild(this.cardContainer);
    document.body.appendChild(this.overlay);
  }

  /**
   * Show the picker modal and wait for the player to select a skill.
   * Applies the selected skill to SkillSystem (and player for instant effects).
   */
  async show(
    skillSystem: SkillSystem,
    player: { hp: number; maxHp: number },
  ): Promise<void> {
    const skills = SkillSystem.pickRandomSkills(3);

    // Build cards
    this.cardContainer.innerHTML = '';
    skills.forEach((skill) => {
      const card = this.buildCard(skill);
      card.addEventListener('click', () => {
        this.selectSkill(skill, skillSystem, player);
      });
      this.cardContainer.appendChild(card);
    });

    // Show overlay
    this.overlay.style.display = 'flex';
    this.overlay.style.opacity = '0';
    this.overlay.style.transition = 'opacity 0.3s ease';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.overlay.style.opacity = '1';
      });
    });

    // Wait for selection
    return new Promise<void>((resolve) => {
      this.resolveSelection = resolve;
    });
  }

  private selectSkill(
    skill: SkillDefinition,
    skillSystem: SkillSystem,
    player: { hp: number; maxHp: number },
  ): void {
    skillSystem.applySkill(skill, player);

    // Fade out and hide
    this.overlay.style.opacity = '0';
    setTimeout(() => {
      this.overlay.style.display = 'none';
      this.resolveSelection?.();
      this.resolveSelection = null;
    }, 300);
  }

  private buildCard(skill: SkillDefinition): HTMLElement {
    const rarityColor = RARITY_COLORS[skill.rarity as SkillRarity];

    const card = document.createElement('div');
    Object.assign(card.style, {
      width: '180px',
      minHeight: '220px',
      background: 'rgba(10,8,20,0.95)',
      border: `2px solid ${rarityColor}`,
      borderRadius: '8px',
      padding: '20px 16px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '10px',
      cursor: 'pointer',
      transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      boxShadow: `0 0 14px rgba(${hexToRgb(rarityColor)},0.25)`,
    });

    card.addEventListener('mouseenter', () => {
      card.style.transform = 'scale(1.06) translateY(-4px)';
      card.style.boxShadow = `0 0 28px rgba(${hexToRgb(rarityColor)},0.55)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'scale(1) translateY(0)';
      card.style.boxShadow = `0 0 14px rgba(${hexToRgb(rarityColor)},0.25)`;
    });

    // Icon
    const icon = document.createElement('div');
    Object.assign(icon.style, {
      fontSize: '40px',
      lineHeight: '1',
    });
    icon.textContent = skill.icon;

    // Rarity label
    const rarity = document.createElement('div');
    Object.assign(rarity.style, {
      fontSize: '11px',
      letterSpacing: '0.2em',
      color: rarityColor,
      textTransform: 'uppercase',
      fontWeight: 'bold',
    });
    rarity.textContent = skill.rarity;

    // Skill name
    const name = document.createElement('div');
    Object.assign(name.style, {
      fontSize: '15px',
      fontWeight: 'bold',
      color: '#e8d5a0',
      textAlign: 'center',
      letterSpacing: '0.05em',
    });
    name.textContent = skill.name;

    // Divider
    const divider = document.createElement('div');
    Object.assign(divider.style, {
      width: '60%',
      height: '1px',
      background: `rgba(${hexToRgb(rarityColor)},0.4)`,
    });

    // Description
    const desc = document.createElement('div');
    Object.assign(desc.style, {
      fontSize: '12px',
      color: '#aaa',
      textAlign: 'center',
      lineHeight: '1.4',
    });
    desc.textContent = skill.description;

    card.appendChild(icon);
    card.appendChild(rarity);
    card.appendChild(name);
    card.appendChild(divider);
    card.appendChild(desc);

    return card;
  }
}

// Helper: convert hex color string to "r,g,b" for rgba()
function hexToRgb(hex: string): string {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `${r},${g},${b}`;
}
