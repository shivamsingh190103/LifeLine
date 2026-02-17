"use strict";

const HERO_BOARD_LIMIT = 10;

const fallbackHeroes = [
  {
    rank: 1,
    name: "You Could Be #1",
    city: "Your City",
    state: "Your State",
    blood_group: "O+",
    donation_count: 0,
    total_units: 0,
    badge: "Legend Hero",
    thank_you_note: "The next life-saving story can begin with your first donation."
  },
  {
    rank: 2,
    name: "Future Gold Hero",
    city: "Near You",
    state: "India",
    blood_group: "A+",
    donation_count: 0,
    total_units: 0,
    badge: "Gold Hero",
    thank_you_note: "Consistent donors make emergency response faster and stronger."
  },
  {
    rank: 3,
    name: "Community Hero",
    city: "Everywhere",
    state: "India",
    blood_group: "B+",
    donation_count: 0,
    total_units: 0,
    badge: "Community Hero",
    thank_you_note: "Your one unit can support trauma, surgery, and critical care."
  }
];

const rankEmoji = rank => {
  if (rank === 1) return "🏆";
  if (rank === 2) return "🥇";
  if (rank === 3) return "🥈";
  return "⭐";
};

const escapeHtml = value => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const formatLocation = hero => {
  const parts = [hero.city, hero.state]
    .map(item => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);

  if (parts.length > 0) {
    return parts.join(", ");
  }

  if (typeof hero.location === "string" && hero.location.trim()) {
    return hero.location.trim();
  }

  return "Location not specified";
};

const normalizeHeroes = heroes => {
  if (!Array.isArray(heroes) || heroes.length === 0) {
    return fallbackHeroes;
  }

  return heroes.map((hero, index) => ({
    rank: Number.parseInt(hero.rank, 10) || index + 1,
    name: hero.name || "Unknown Hero",
    city: hero.city || "",
    state: hero.state || "",
    location: hero.location || "",
    blood_group: hero.blood_group || "--",
    donation_count: Number.parseInt(hero.donation_count, 10) || 0,
    total_units: Number.parseInt(hero.total_units, 10) || 0,
    badge: hero.badge || "Community Hero",
    thank_you_note: hero.thank_you_note || "Thank you for saving lives through blood donation."
  }));
};

const renderHeroList = heroes => {
  const board = document.getElementById("liveSuperheroList");
  if (!board) {
    return;
  }

  board.innerHTML = heroes
    .slice(0, HERO_BOARD_LIMIT)
    .map(hero => `
      <li class="vol">
        <span class="vol-i number">${escapeHtml(hero.rank)} ${rankEmoji(hero.rank)}</span>
        <span class="vol-i name">
          ${escapeHtml(hero.name)}
          <span class="hero-meta">${escapeHtml(hero.badge)}</span>
        </span>
        <span class="vol-i location">
          ${escapeHtml(formatLocation(hero))}
          <span class="hero-meta">${escapeHtml(hero.thank_you_note)}</span>
        </span>
        <span class="vol-i blood">
          ${escapeHtml(hero.blood_group)} <i class="fa fa-tint" aria-hidden="true"></i>
          <span class="hero-meta">${escapeHtml(hero.donation_count)} donations • ${escapeHtml(hero.total_units)} units</span>
        </span>
      </li>
    `)
    .join("");
};

const renderHonourCards = heroes => {
  const cardsContainer = document.getElementById("heroHonourCards");
  if (!cardsContainer) {
    return;
  }

  const highlighted = heroes.slice(0, 3);
  cardsContainer.innerHTML = highlighted
    .map(hero => `
      <div class="hero-honour-card">
        <h3>${rankEmoji(hero.rank)} #${escapeHtml(hero.rank)} ${escapeHtml(hero.name)}</h3>
        <p>${escapeHtml(hero.badge)} • ${escapeHtml(hero.donation_count)} donations • ${escapeHtml(hero.total_units)} units</p>
        <p>${escapeHtml(hero.thank_you_note)}</p>
      </div>
    `)
    .join("");
};

const setHeroBoardStatus = text => {
  const status = document.getElementById("heroBoardStatus");
  if (status) {
    status.textContent = text;
  }
};

const setHeroEncouragement = text => {
  const note = document.getElementById("heroEncouragement");
  if (note) {
    note.textContent = text;
  }
};

const loadSuperheroes = async () => {
  setHeroBoardStatus("Loading live donor leaderboard...");

  try {
    const response = await fetch("/api/donations/superheroes?limit=10&days=365");
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.message || "Failed to fetch superheroes");
    }

    const heroes = normalizeHeroes(payload.superheroes);
    renderHeroList(heroes);
    renderHonourCards(heroes);

    if (Array.isArray(payload.superheroes) && payload.superheroes.length > 0) {
      setHeroBoardStatus(`Live leaderboard updated: top ${payload.superheroes.length} active life-saving donors`);
      setHeroEncouragement("Inspired by these heroes? Donate now and earn your place in the Hall of Honor.");
    } else {
      setHeroBoardStatus("No completed donations found yet. Your donation can become the first hero story.");
      setHeroEncouragement("Start the movement in your city. One blood donation can save multiple lives.");
    }
  } catch (error) {
    const heroes = normalizeHeroes([]);
    renderHeroList(heroes);
    renderHonourCards(heroes);
    setHeroBoardStatus("Live board is temporarily unavailable. Showing motivation board.");
    setHeroEncouragement("Every hero starts with one donation. Register now and encourage your friends to donate.");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const refreshBtn = document.getElementById("refreshHeroesBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadSuperheroes();
    });
  }

  loadSuperheroes();
});
