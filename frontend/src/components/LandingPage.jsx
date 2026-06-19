import React from 'react';
import { motion } from 'framer-motion';
import { Gauge, PlayCircle, FileSearch, GitBranch, MessagesSquare, Search, Sparkles } from 'lucide-react';
import './LandingPage.css';

const LandingPage = ({ onGetStarted }) => {
  return (
    <div className="landing-page">
      {/* Navbar */}
      <nav className="lp-navbar">
        <div className="lp-logo">
          <Gauge size={28} className="text-primary" />
          Caliber
        </div>
        <div className="lp-nav-links">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#features">Resume · GitHub · Interview</a>
        </div>
        <div className="lp-nav-actions">
          <button className="lp-btn-ghost" onClick={onGetStarted}>Sign In</button>
          <button className="lp-btn-primary" onClick={onGetStarted}>Get Started</button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="lp-hero">
        <div className="lp-hero-content">
          <div className="lp-badge">
            <Sparkles size={14} /> AI INTERVIEW &amp; RESUME COACH
          </div>
          <h1 className="lp-title">
            Get hired with
            <span className="lp-title-highlight">Caliber</span>
          </h1>
          <p className="lp-subtitle">
            One AI coach for the whole job hunt — get an ATS-grounded resume review, a recruiter-style
            GitHub audit, and adaptive mock interviews that grade you and tell you exactly what to fix.
          </p>
          <div className="lp-hero-actions">
            <button className="lp-btn-primary lp-btn-large" onClick={onGetStarted}>
              Get Started for Free
            </button>
            <button className="lp-btn-secondary" onClick={onGetStarted}>
              <PlayCircle size={20} />
              Try it now
            </button>
          </div>
          <div className="lp-stats">
            <div className="lp-stat-item">
              <h3>3-in-1</h3>
              <p>Resume · GitHub · Interview</p>
            </div>
            <div className="lp-stat-item">
              <h3>Real-time</h3>
              <p>Streaming AI responses</p>
            </div>
            <div className="lp-stat-item">
              <h3>24/7</h3>
              <p>Always available</p>
            </div>
          </div>
        </div>
        <div className="lp-hero-visual">
          <motion.img
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            src="/hero_mockup.png"
            alt="Caliber dashboard"
            className="lp-hero-image"
          />
        </div>
      </section>

      {/* What Caliber does */}
      <section className="lp-features" id="features">
        <p className="lp-features-eyebrow">WHAT CALIBER DOES</p>
        <h2 className="lp-features-title">Everything you need to get hired</h2>
        <div className="lp-feature-grid">
          <div className="lp-feature-card">
            <div className="lp-feature-icon"><FileSearch size={24} /></div>
            <h3>ATS Resume Review</h3>
            <p>Score your resume against any role — with rewritten bullets and the exact keywords recruiter ATS systems scan for.</p>
          </div>
          <div className="lp-feature-card">
            <div className="lp-feature-icon"><GitBranch size={24} /></div>
            <h3>GitHub Profile Review</h3>
            <p>A recruiter-style audit of your real repos — activity, READMEs, top projects, and exactly what to fix.</p>
          </div>
          <div className="lp-feature-card">
            <div className="lp-feature-icon"><MessagesSquare size={24} /></div>
            <h3>Adaptive Mock Interviews</h3>
            <p>Questions that adapt to your level, graded in real time, with a report on precisely where to improve.</p>
          </div>
          <div className="lp-feature-card">
            <div className="lp-feature-icon"><Search size={24} /></div>
            <h3>Live Web Search</h3>
            <p>Grounded, current answers — Caliber checks the web when it needs facts, and never fabricates.</p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="lp-cta-wrapper" id="how">
        <div className="lp-cta-card">
          <h2 className="lp-cta-title">Upload your resume. Get hired-ready in minutes.</h2>
          <p className="lp-cta-subtitle">
            Caliber scores your resume against the role, rewrites weak bullets, audits your GitHub like a
            recruiter, and runs a mock interview — all grounded in your real data, no fabrication.
          </p>
          <div className="lp-cta-actions">
            <button className="lp-btn-white" onClick={onGetStarted}>Start for Free</button>
            <button className="lp-btn-outline" onClick={onGetStarted}>Sign In</button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-footer-grid">
          <div className="lp-footer-brand">
            <div className="lp-logo">
              <Gauge size={24} className="text-primary" />
              Caliber
            </div>
            <p>Your AI interview &amp; resume coach — ATS resume reviews, recruiter-style GitHub audits, and adaptive mock interviews, grounded in your real data.</p>
          </div>
          <div className="lp-footer-col">
            <h4>PRODUCT</h4>
            <ul>
              <li><a href="#features">Resume Review</a></li>
              <li><a href="#features">GitHub Review</a></li>
              <li><a href="#features">Mock Interviews</a></li>
              <li><a href="#how">How it works</a></li>
            </ul>
          </div>
          <div className="lp-footer-col">
            <h4>GET STARTED</h4>
            <ul>
              <li><a href="#" onClick={(e) => { e.preventDefault(); onGetStarted(); }}>Sign In</a></li>
              <li><a href="#" onClick={(e) => { e.preventDefault(); onGetStarted(); }}>Create account</a></li>
            </ul>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <span>© 2026 Caliber. All rights reserved.</span>
          <span>Built for job seekers, grounded in real data.</span>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
