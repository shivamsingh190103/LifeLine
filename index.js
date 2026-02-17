"use strict";

const HERO_BOARD_LIMIT = 8;
const HERO_ROTATING_QUOTES = [
  "One bag of blood can carry hope to three lives.",
  "Your 15 minutes can become someone else's tomorrow.",
  "Real heroes do not wear capes. They donate.",
  "Small act, massive impact. Keep saving lives."
];

const fallbackHeroes = [
  {
    rank: 1,
    name: "You Could Be #1",
    city: "Your City",
    state: "India",
    blood_group: "O+",
    donation_count: 0,
    total_units: 0,
    badge: "Legend Hero",
    thank_you_note: "First verified donation unlocks your hero journey."
  },
  {
    rank: 2,
    name: "Future Gold Hero",
    city: "Nearby",
    state: "India",
    blood_group: "A+",
    donation_count: 0,
    total_units: 0,
    badge: "Gold Hero",
    thank_you_note: "Consistent donors keep emergencies under control."
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
    thank_you_note: "Every verified unit means one more family gets relief."
  }
];

const fallbackTestimonials = [
  {
    user_name: "Esha Puri",
    rating: 5,
    feedback_text: "My first donation experience was smooth and safe. Highly recommended."
  },
  {
    user_name: "Amit Mangal",
    rating: 5,
    feedback_text: "We found blood support quickly during emergency. The response was fast."
  },
  {
    user_name: "Dr. Kabir Khatri",
    rating: 4,
    feedback_text: "A practical platform for urgent coordination between donors and patients."
  }
];

let testimonials = [];
let testimonialIndex = 0;
let testimonialTimer = null;

const escapeHtml = value => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const rankEmoji = rank => {
  if (rank === 1) return "🏆";
  if (rank === 2) return "🥇";
  if (rank === 3) return "🥈";
  return "⭐";
};

const formatLocation = item => {
  const parts = [item.city, item.state]
    .map(value => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  if (parts.length > 0) {
    return parts.join(", ");
  }

  if (typeof item.location === "string" && item.location.trim()) {
    return item.location.trim();
  }

  return "Location not specified";
};

const compactHeroNote = hero => {
  if (hero.rank === 1) {
    return "Leading the life-saving mission.";
  }
  if (hero.rank === 2 || hero.rank === 3) {
    return "Consistent donor making real impact.";
  }
  return "Verified donor supporting emergency care.";
};

const setHeroBoardStatus = text => {
  const status = document.getElementById("heroBoardStatus");
  if (status) {
    status.textContent = text;
  }
};

const setHeroQuote = quote => {
  const node = document.getElementById("heroQuote");
  if (node) {
    node.textContent = quote;
  }
};

const setHeroEncouragement = text => {
  const node = document.getElementById("heroEncouragement");
  if (node) {
    node.textContent = text;
  }
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
    thank_you_note: hero.thank_you_note || "Thank you for your verified donations."
  }));
};

const renderHeroCards = heroes => {
  const cardsNode = document.getElementById("heroHonourCards");
  if (!cardsNode) {
    return;
  }

  const topHeroes = heroes.slice(0, 3);
  cardsNode.innerHTML = topHeroes.map(hero => `
    <article class="hero-honour-card">
      <h3>${rankEmoji(hero.rank)} #${escapeHtml(hero.rank)} ${escapeHtml(hero.name)}</h3>
      <p>${escapeHtml(hero.badge)} • ${escapeHtml(hero.donation_count)} donations • ${escapeHtml(hero.total_units)} units</p>
      <p>${escapeHtml(compactHeroNote(hero))}</p>
    </article>
  `).join("");
};

const renderHeroList = heroes => {
  const listNode = document.getElementById("liveSuperheroList");
  if (!listNode) {
    return;
  }

  listNode.innerHTML = heroes.slice(0, HERO_BOARD_LIMIT).map(hero => `
    <li class="vol">
      <div class="hero-row-main">
        <span class="hero-rank-pill">${rankEmoji(hero.rank)} #${escapeHtml(hero.rank)}</span>
        <strong>${escapeHtml(hero.name)}</strong>
      </div>
      <div class="hero-row-meta">
        <span>${escapeHtml(hero.blood_group)} • ${escapeHtml(hero.donation_count)} donations • ${escapeHtml(hero.total_units)} units</span>
        <span>${escapeHtml(formatLocation(hero))}</span>
      </div>
      <p class="hero-mini-quote">${escapeHtml(compactHeroNote(hero))}</p>
    </li>
  `).join("");
};

const loadSuperheroes = async () => {
  setHeroBoardStatus("Loading live donor leaderboard...");

  try {
    const response = await fetch("/api/donations/superheroes?limit=8&days=365");
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.message || "Failed to load superheroes");
    }

    const heroes = normalizeHeroes(payload.superheroes);
    renderHeroCards(heroes);
    renderHeroList(heroes);

    if (Array.isArray(payload.superheroes) && payload.superheroes.length > 0) {
      setHeroBoardStatus(`Top ${payload.superheroes.length} verified active donors`);
      setHeroQuote(HERO_ROTATING_QUOTES[Math.floor(Math.random() * HERO_ROTATING_QUOTES.length)]);
      setHeroEncouragement("Join today. Your next verified donation can place you on this board.");
    } else {
      setHeroBoardStatus("No verified donations yet. You can lead this board.");
      setHeroQuote(HERO_ROTATING_QUOTES[0]);
      setHeroEncouragement("Be the first verified hero for your city.");
    }
  } catch (error) {
    const heroes = normalizeHeroes([]);
    renderHeroCards(heroes);
    renderHeroList(heroes);
    setHeroBoardStatus("Live board unavailable. Showing motivation preview.");
    setHeroQuote(HERO_ROTATING_QUOTES[2]);
    setHeroEncouragement("Start your donor journey now and inspire others.");
  }
};

const normalizeTestimonials = items => {
  if (!Array.isArray(items) || items.length === 0) {
    return fallbackTestimonials;
  }

  const mapped = items
    .map(item => {
      const rating = Number.parseInt(item.rating, 10);
      const text = typeof item.feedback_text === "string" ? item.feedback_text.trim() : "";
      const name = typeof item.user_name === "string" && item.user_name.trim()
        ? item.user_name.trim()
        : "LifeLine User";

      if (!text) {
        return null;
      }

      return {
        user_name: name,
        rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : 5,
        feedback_text: text
      };
    })
    .filter(Boolean);

  return mapped.length > 0 ? mapped : fallbackTestimonials;
};

const renderTestimonialDots = () => {
  const dotsNode = document.getElementById("testimonialDots");
  if (!dotsNode) {
    return;
  }

  dotsNode.innerHTML = testimonials.map((_, index) => `
    <button
      type="button"
      class="testimonial-dot ${index === testimonialIndex ? "active" : ""}"
      data-testimonial-index="${index}"
      aria-label="Show testimonial ${index + 1}"
    ></button>
  `).join("");
};

const renderTestimonialTrack = () => {
  const trackNode = document.getElementById("testimonialTrack");
  if (!trackNode) {
    return;
  }

  trackNode.innerHTML = testimonials.map(item => `
    <article class="testimonial-card">
      <p class="testimonial-stars">${"★".repeat(item.rating)}${"☆".repeat(5 - item.rating)}</p>
      <p class="testimonial-text">“${escapeHtml(item.feedback_text)}”</p>
      <p class="testimonial-user">${escapeHtml(item.user_name)}</p>
    </article>
  `).join("");

  trackNode.style.transform = `translateX(-${testimonialIndex * 100}%)`;
  renderTestimonialDots();
};

const goToTestimonial = index => {
  if (!Array.isArray(testimonials) || testimonials.length === 0) {
    return;
  }

  testimonialIndex = (index + testimonials.length) % testimonials.length;
  const trackNode = document.getElementById("testimonialTrack");
  if (trackNode) {
    trackNode.style.transform = `translateX(-${testimonialIndex * 100}%)`;
  }
  renderTestimonialDots();
};

const startTestimonialAutoplay = () => {
  if (testimonialTimer) {
    clearInterval(testimonialTimer);
  }
  testimonialTimer = setInterval(() => {
    goToTestimonial(testimonialIndex + 1);
  }, 5500);
};

const loadTestimonials = async () => {
  const scoreNode = document.getElementById("testimonialScore");

  try {
    const [recentResponse, summaryResponse] = await Promise.all([
      fetch("/api/feedback/recent?limit=12"),
      fetch("/api/feedback/summary")
    ]);
    const recentPayload = await recentResponse.json();
    const summaryPayload = await summaryResponse.json();

    testimonials = normalizeTestimonials(recentPayload.feedback);
    testimonialIndex = 0;
    renderTestimonialTrack();
    startTestimonialAutoplay();

    if (scoreNode && summaryResponse.ok && summaryPayload.success && summaryPayload.summary) {
      const avg = Number(summaryPayload.summary.average_rating || 0).toFixed(1);
      const count = Number(summaryPayload.summary.total_feedback || 0);
      scoreNode.textContent = `Community Rating: ${avg} / 5 (${count} reviews)`;
    } else if (scoreNode) {
      scoreNode.textContent = "Community Rating: Updated from recent user feedback";
    }
  } catch (error) {
    testimonials = fallbackTestimonials;
    testimonialIndex = 0;
    renderTestimonialTrack();
    startTestimonialAutoplay();
    if (scoreNode) {
      scoreNode.textContent = "Community Rating: Real user stories";
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const refreshHeroesBtn = document.getElementById("refreshHeroesBtn");
  const prevBtn = document.getElementById("testimonialPrevBtn");
  const nextBtn = document.getElementById("testimonialNextBtn");
  const dotsNode = document.getElementById("testimonialDots");

  if (refreshHeroesBtn) {
    refreshHeroesBtn.addEventListener("click", loadSuperheroes);
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      goToTestimonial(testimonialIndex - 1);
      startTestimonialAutoplay();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      goToTestimonial(testimonialIndex + 1);
      startTestimonialAutoplay();
    });
  }

  if (dotsNode) {
    dotsNode.addEventListener("click", event => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.matches("[data-testimonial-index]")) {
        const index = Number.parseInt(target.dataset.testimonialIndex, 10);
        if (Number.isInteger(index)) {
          goToTestimonial(index);
          startTestimonialAutoplay();
        }
      }
    });
  }

  loadSuperheroes();
  loadTestimonials();
});
