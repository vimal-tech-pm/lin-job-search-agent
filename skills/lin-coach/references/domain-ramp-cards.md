# Domain Ramp Cards — Interview Edition

When the candidate has **zero experience** in the company's industry, include a dedicated "Domain Ramp Card" section in the interview-prep.md (section #5). This gives them the vocabulary, concepts, and framing they need to sound credible despite the gap.

**Strategy:** Don't fake domain expertise — acknowledge the gap, show you've done the homework, and prove you know how to learn new domains systematically.

---

## Worked Example 1: Gaming Industry (Zynga — Sr Tech PM, ML & Analytics)

### Key Gaming Metrics

| Metric | Meaning | Why it matters |
|--------|---------|----------------|
| **DAU/MAU** | Daily/Monthly Active Users | Core engagement measure |
| **D1/D7/D30 Retention** | % playing after 1/7/30 days | Retention is #1 KPI in F2P games |
| **ARPDAU** | Avg Revenue Per Daily Active User | Monetization efficiency |
| **LTV** | Lifetime Value | How much a player is worth over time |
| **CAC** | Customer Acquisition Cost | Cost to acquire a paying user |
| **ROAS** | Return on Ad Spend | UA efficiency (critical for Zynga) |
| **Session Length/Frequency** | How long/often people play | Engagement health |

### ML in Gaming (use cases to mention)

1. **Player Personalization** — Recommend content, offers, difficulty per player
2. **Churn Prediction** — Identify at-risk players, trigger re-engagement
3. **UA Optimization** — Model which ad channels yield highest-LTV users
4. **Fraud Detection** — Casino games: bot/fraud activity
5. **Dynamic Difficulty** — Adjust challenge to maximize retention
6. **Pricing Optimization** — Model optimal IAP pricing per segment

### What to Say When Asked About No Gaming Experience

> *"Gaming is new to me, but the core metrics — engagement, retention, conversion — are the same ones I've optimized for 14 years. What's different is data velocity and volume, which is actually an advantage for ML. My ramp plan: (1) Play the top games. (2) Deep-dive existing data infrastructure. (3) Shadow game team PMs. (4) Identify one quick win within 60 days."*

---

## Worked Example 2: Field Service / Vertical SaaS (Skimmer — Sr PM)

### Key Field Service Concepts

| Concept | Meaning | Why it matters |
|---------|---------|----------------|
| **Route Optimization** | Smart scheduling minimizing drive time | Core value prop — "Drive less, save more" |
| **Mobile-first** | Techs work from phones, not desks | Critical for adoption |
| **Chemical Dosing** | Tracking pool chemical levels/treatments | Niche differentiator from generic field service software |
| **Stop/Ticket Management** | Each service visit = a "stop" | Core workflow |
| **Seasonal Demand** | Pool business peaks summer, drops winter | Pricing, resource planning |
| **Field Compliance** | Water chemistry logs, safety checklists | Regulatory/liability |
| **Customer Retention in Trades** | Pool owners switch providers often | Portal + billing = retention levers |

### Competitor Landscape
- **Larger competitors:** ServiceTitan ($100M+ ARR, $9.5B valuation), Housecall Pro
- **Niche advantage:** Pool/spa specific — deeper feature fit, higher NPS
- **PE backing (Mainsail Partners):** Growth capital, 5-7 year hold, building for exit

### What to Say When Asked About No Field Service Experience

> *"I haven't worked in this industry. But I've learned three different regulated industries from scratch: lending, legal/tax tech, and enterprise SaaS. The product muscles are the same — understanding user workflows, identifying bottlenecks, prioritizing by impact. The domain comes from immersion. My first 30 days would be ride-alongs with pool techs, watching how they use the app. I go deep fast, and I bring pattern recognition from the last three industries I've learned."*

---

## Worked Example 3: Cybersecurity / Identity Security (Semperis — PM Agentic AI)

This is the steepest ramp — the candidate needs to pass as credible in a deeply technical security domain.

### Must-Know Concepts

| Concept | Plain English | Why Semperis Cares |
|---------|--------------|--------------------|
| **Active Directory (AD)** | Microsoft's on-prem directory — users, computers, permissions | Core to every Semperis product |
| **Entra ID** | Cloud identity (formerly Azure AD) | Hybrid identity coverage |
| **Domain Controller (DC)** | Server running AD — authenticates users | Protecting DCs is job #1 |
| **Forest / Domain** | Forest = top-level AD container | Forest Recovery = core product |
| **Kerberos / NTLM** | Authentication protocols | Attackers exploit these |
| **Golden Ticket Attack** | Forge Kerberos ticket for unlimited AD access | Classic AD attack Semperis detects |
| **DCSync Attack** | Attacker impersonates DC to steal password hashes | High-severity, Semperis detects |
| **Attack Path** | Chain of exploits from entry to high-value target | Lightning Intelligence maps these |
| **Least Privilege** | Minimum permissions needed | Delegation Manager enforces this |
| **ITDR** | Identity Threat Detection and Response | Semperis pioneered this Gartner category |
| **Service Account** | Non-human account used by apps | Often over-privileged, major attack vector |
| **Purple Knight** | Semperis's free AD security assessment tool | **Download and run before interview** |
| **SOC / SIEM / SOAR** | Security Operations / Info & Event Mgmt / Orchestration & Response | How security teams operate |

### Semperis Product Knowledge

| Product | What it does | Interview relevance |
|---------|-------------|-------------------|
| Directory Services Protector (DSP) | AD/Entra ID threat prevention, detection, response | Core product — AI features integrate here |
| Active Directory Forest Recovery (ADFR) | AD disaster recovery after ransomware | Understand AD forest structure |
| Lightning Intelligence | SaaS AD/Entra ID security posture + attack path mgmt | Key AI play — continuous monitoring |
| Purple Knight | Free AD security assessment | Download, run, discuss |
| Delegation Manager | AD delegation, privilege elimination | Least-privilege concept |
| Migrator for AD | AD migration | Platform tooling |

### What to Say When Asked About No Security Background

> *"I don't have a security background. But this role needs an AI PM who understands agentic workflows and human-in-the-loop design — that's my strongest capability. I've learned three complex domains from scratch, each time product-credible within 60 days. Your security experts already know identity security. What they lack is a PM who can structure the AI roadmap, run discovery, and ship. Here's my 60-day plan: (1) Purple Knight + white papers. (2) Shadow SOC analysts. (3) CISO customer interviews. (4) First product recommendation."*

### White Papers to Read Before the Interview

- "Introducing AI Agents to your Identity Fabric" (on semperis.com)
- "The State of Identity Security in the AI Era" (annual report on semperis.com)

---

## Pattern: Building a Domain Ramp Card from Scratch

When you encounter a new domain gap, build the ramp card using this approach:

1. **Company website:** Extract product names, one-liner descriptions, and customer logos from the homepage and product pages.
2. **JD itself:** Pull out technical terms mentioned (APIs, data models, orchestration, AD, IAM, etc.) — these are the terms the interviewers will use.
3. **Google search (or browser):** Search "{company} product explained" or "{industry} key concepts" for a quick glossary.
4. **Consult the resume:** Check if the candidate has ANY adjacent experience (compliance, regulated industry, technical infrastructure) that can be reframed as security-adjacent.
5. **Write the "what to say" framing:** The candidate needs an honest acknowledgment + a ramp plan. Never let them fake domain expertise.
