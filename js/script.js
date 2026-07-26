// ============ Footer year ============
document.getElementById('year').textContent = new Date().getFullYear();

// ============ Mobile nav toggle ============
const navToggle = document.getElementById('navToggle');
const mainNav = document.getElementById('mainNav');
navToggle.addEventListener('click', () => {
  const isOpen = mainNav.classList.toggle('is-open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
});
mainNav.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    mainNav.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
  });
});

// ============ Scroll reveal ============
const revealTargets = document.querySelectorAll(
  '.about-inner, .services-grid .service-card, .locations-grid .location-card, .testimonial-carousel, .hero-inner'
);
revealTargets.forEach(el => el.classList.add('reveal'));

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });

revealTargets.forEach(el => revealObserver.observe(el));

// ============ Insights / Articles ============
const articlesGrid = document.getElementById('articlesGrid');
const articlesEmpty = document.getElementById('articlesEmpty');
if (articlesGrid && articlesEmpty) {
  articlesEmpty.style.display = articlesGrid.children.length ? 'none' : '';
}

document.querySelectorAll('.article-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const full = btn.closest('.article-body').querySelector('.article-full');
    const isHidden = full.hasAttribute('hidden');
    full.toggleAttribute('hidden');
    btn.textContent = isHidden ? 'Show less' : 'Read full article';
  });
});

// ============ Testimonial carousel ============
const carouselTrack = document.getElementById('carouselTrack');
const carouselDots = document.getElementById('carouselDots');
const carouselPrev = document.getElementById('carouselPrev');
const carouselNext = document.getElementById('carouselNext');
const slides = Array.from(carouselTrack.children);
let currentSlide = 0;

slides.forEach((_, i) => {
  const dot = document.createElement('button');
  dot.className = 'carousel-dot';
  dot.type = 'button';
  dot.setAttribute('aria-label', `Go to testimonial ${i + 1}`);
  dot.addEventListener('click', () => goToSlide(i));
  carouselDots.appendChild(dot);
});
const dots = Array.from(carouselDots.children);

function goToSlide(index) {
  currentSlide = (index + slides.length) % slides.length;
  carouselTrack.style.transform = `translateX(-${currentSlide * 100}%)`;
  dots.forEach((dot, i) => dot.classList.toggle('is-active', i === currentSlide));
}

carouselPrev.addEventListener('click', () => goToSlide(currentSlide - 1));
carouselNext.addEventListener('click', () => goToSlide(currentSlide + 1));
goToSlide(0);

// ============ Chatbot ============
const KOVILAMBAKKAM_TEL = '+919840345363';
const ALANDUR_TEL = '+919342297922';

const FAQ = [
  {
    id: 'greeting',
    keywords: ['hello', 'hi', 'hey', 'good morning', 'good evening'],
    response: "Hello! I'm the C-MEDiS assistant. I can help with our services, locations, doctor's specialties, or booking an appointment. What would you like to know?"
  },
  {
    id: 'services',
    keywords: ['service', 'services', 'offer', 'tests', 'lab', 'ecg', 'echo', 'echocardiogram', 'cgm', 'glucose monitor', 'body composition', 'iv', 'infusion', 'obesity clinic', 'what do you do', 'treatments'],
    response: "We offer: Lab diagnostics, ECG, Echocardiogram, Continuous Glucose Monitoring (CGM), Body composition measurement, IV infusions &amp; resuscitation, and a dedicated Obesity Clinic."
  },
  {
    id: 'conditions',
    keywords: ['diabetes', 'sugar', 'gdm', 'gestational', 'obesity', 'weight', 'metabolic', 'sleep apnea', 'sleep', 'snoring', 'thyroid', 'endocrine', 'infection', 'condition', 'treat'],
    response: "Dr. Bharathi specializes in Type 1 &amp; Type 2 diabetes, gestational diabetes (GDM), obesity &amp; metabolic disease, and sleep apnea — with certifications in CCEBDM, CCGDM, Sleep Apnea, and CIDS AMR Stewardship."
  },
  {
    id: 'doctor',
    keywords: ['doctor', 'dr', 'bharathi', 'who', 'qualification', 'credentials', 'specialist', 'specialize'],
    response: "Your doctor is Dr. Sai Lakshmikanth Bharathi, MD, specializing in diabetes, obesity/metabolic disease, and sleep apnea, with CCEBDM, CCGDM, Sleep Apnea, and CIDS AMR Stewardship certifications."
  },
  {
    id: 'locations',
    keywords: ['location', 'locations', 'address', 'where', 'clinic', 'kovilambakkam', 'alandur', 'branch', 'directions'],
    response: "We have two locations:<br>• <strong>SB Health, Kovilambakkam</strong> — 1/512, S. Kolathur, Sathya Nagar, Viduthalai Nagar, Kovilambakkam, Chennai 600129<br>• <strong>SB Speciality Clinic, Alandur</strong> — Alandur, Chennai"
  },
  {
    id: 'hours',
    keywords: ['hours', 'timing', 'timings', 'open', 'close', 'closing', 'time'],
    response: "Clinic timings can vary by day — please call the clinic directly to confirm today's hours before you visit."
  },
  {
    id: 'appointment',
    keywords: ['appointment', 'book', 'booking', 'schedule', 'consult', 'consultation', 'visit', 'call'],
    response: `To book an appointment, just give us a call:<br>• Kovilambakkam: <a href="tel:${KOVILAMBAKKAM_TEL}">98403 45363</a><br>• Alandur: <a href="tel:${ALANDUR_TEL}">93422 97922</a>`
  },
  {
    id: 'contact',
    keywords: ['phone', 'number', 'contact', 'reach'],
    response: `You can reach us at:<br>• Kovilambakkam: <a href="tel:${KOVILAMBAKKAM_TEL}">98403 45363</a><br>• Alandur: <a href="tel:${ALANDUR_TEL}">93422 97922</a>`
  }
];

const FALLBACK = "I'm not sure about that one — for anything specific to your health, it's best to call us directly: " +
  `<a href="tel:${KOVILAMBAKKAM_TEL}">Kovilambakkam</a> or <a href="tel:${ALANDUR_TEL}">Alandur</a>. ` +
  "You can also ask me about our services, locations, doctor's specialties, or booking.";

const SUGGESTIONS = ['Services', 'Locations', 'Book an appointment', "Doctor's specialties"];

function matchFAQ(text) {
  const lower = text.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const entry of FAQ) {
    const score = entry.keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best ? best.response : FALLBACK;
}

const chatbot = document.getElementById('chatbot');
const chatbotToggle = document.getElementById('chatbotToggle');
const chatbotMessages = document.getElementById('chatbotMessages');
const chatbotForm = document.getElementById('chatbotForm');
const chatbotInput = document.getElementById('chatbotInput');
const chatbotSuggestions = document.getElementById('chatbotSuggestions');

function addMessage(text, sender) {
  const div = document.createElement('div');
  div.className = `msg msg-${sender}`;
  div.innerHTML = text;
  chatbotMessages.appendChild(div);
  chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
}

function renderSuggestions() {
  chatbotSuggestions.innerHTML = '';
  SUGGESTIONS.forEach(label => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.textContent = label;
    chip.addEventListener('click', () => handleUserMessage(label));
    chatbotSuggestions.appendChild(chip);
  });
}

function handleUserMessage(text) {
  if (!text.trim()) return;
  addMessage(text, 'user');
  chatbotInput.value = '';
  setTimeout(() => {
    addMessage(matchFAQ(text), 'bot');
  }, 350);
}

let initialized = false;
chatbotToggle.addEventListener('click', () => {
  chatbot.classList.toggle('is-open');
  if (!initialized && chatbot.classList.contains('is-open')) {
    initialized = true;
    addMessage("Hi! I'm the C-MEDiS assistant. Ask me about our services, locations, doctor's specialties, or how to book an appointment.", 'bot');
    renderSuggestions();
  }
});

chatbotForm.addEventListener('submit', (e) => {
  e.preventDefault();
  handleUserMessage(chatbotInput.value);
});
