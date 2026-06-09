/**
 * profiles.js — Profili di valutazione per tipologia di orologio
 *
 * Due profili:
 *  - SOVIET: standard di fabbrica sovietici (tolleranze larghe, tipiche USSR)
 *  - MODERN: standard svizzeri/giapponesi contemporanei
 *
 * Ogni parametro ha soglie per: OTTIMO / BUONO / ACCETTABILE / SCARSO / CRITICO
 */

export const PROFILES = {
  soviet: {
    id: 'soviet',
    label: 'Sovietico / Russo',
    labelShort: 'USSR / Russia',
    description: 'Standard di fabbrica sovietici. Uscivano dalla fabbrica con ±15–30 sec/giorno come norma.',
    emoji: '☭',

    rate: {
      // secondi/giorno — positivo = avanza, negativo = ritarda
      excellent:    { min: -10, max: +10,  label: 'Ottimo',      color: 'green' },
      good:         { min: -20, max: +20,  label: 'Buono',       color: 'lime' },
      acceptable:   { min: -30, max: +30,  label: 'Accettabile', color: 'yellow' },
      poor:         { min: -60, max: +60,  label: 'Scarso',      color: 'orange' },
      // oltre ±60: critico
      criticalLabel: 'Critico',
      criticalColor: 'red',
      unit: 's/giorno'
    },

    beatError: {
      // millisecondi — valore assoluto
      excellent:    { max: 0.5,  label: 'Ottimo',      color: 'green' },
      good:         { max: 1.2,  label: 'Buono',       color: 'lime' },
      acceptable:   { max: 2.0,  label: 'Accettabile', color: 'yellow' },
      poor:         { max: 3.5,  label: 'Scarso',      color: 'orange' },
      criticalLabel: 'Critico',
      criticalColor: 'red',
      unit: 'ms'
    },

    amplitude: {
      // gradi
      excellent:    { min: 260, max: 330, label: 'Ottima',      color: 'green' },
      good:         { min: 230, max: 260, label: 'Buona',       color: 'lime' },
      acceptable:   { min: 200, max: 230, label: 'Accettabile', color: 'yellow' },
      poor:         { min: 160, max: 200, label: 'Bassa',       color: 'orange' },
      tooHigh:      { min: 330,           label: 'Troppo alta', color: 'orange' },
      criticalLabel: 'Critica (revisione necessaria)',
      criticalColor: 'red',
      unit: '°'
    },

    // Verdetto finale
    verdict: {
      keep:    { label: 'TIENI',          sub: 'Orologio in buone condizioni',            color: '#4caf50' },
      adjust:  { label: 'REGOLA',         sub: 'Regolazione o oliatura consigliata',      color: '#ff9800' },
      service: { label: 'REVISIONE',      sub: 'Necessita revisione completa',            color: '#f44336' },
      skip:    { label: 'SCARTA',         sub: 'Non conveniente o irrecuperabile',        color: '#9c27b0' }
    }
  },

  modern: {
    id: 'modern',
    label: 'Svizzero / Giapponese / Moderno',
    labelShort: 'Swiss / JP / Modern',
    description: 'Standard contemporanei. COSC richiede -4/+6 sec/giorno.',
    emoji: '⌚',

    rate: {
      excellent:    { min: -5,  max: +5,   label: 'Ottimo',      color: 'green' },
      good:         { min: -10, max: +10,  label: 'Buono',       color: 'lime' },
      acceptable:   { min: -20, max: +20,  label: 'Accettabile', color: 'yellow' },
      poor:         { min: -40, max: +40,  label: 'Scarso',      color: 'orange' },
      criticalLabel: 'Critico',
      criticalColor: 'red',
      unit: 's/giorno'
    },

    beatError: {
      excellent:    { max: 0.3,  label: 'Ottimo',      color: 'green' },
      good:         { max: 0.7,  label: 'Buono',       color: 'lime' },
      acceptable:   { max: 1.0,  label: 'Accettabile', color: 'yellow' },
      poor:         { max: 2.0,  label: 'Scarso',      color: 'orange' },
      criticalLabel: 'Critico',
      criticalColor: 'red',
      unit: 'ms'
    },

    amplitude: {
      excellent:    { min: 270, max: 315, label: 'Ottima',      color: 'green' },
      good:         { min: 245, max: 270, label: 'Buona',       color: 'lime' },
      acceptable:   { min: 215, max: 245, label: 'Accettabile', color: 'yellow' },
      poor:         { min: 180, max: 215, label: 'Bassa',       color: 'orange' },
      tooHigh:      { min: 315,           label: 'Troppo alta', color: 'orange' },
      criticalLabel: 'Critica (revisione necessaria)',
      criticalColor: 'red',
      unit: '°'
    },

    verdict: {
      keep:    { label: 'TIENI',          sub: 'Orologio in ottime condizioni',           color: '#4caf50' },
      adjust:  { label: 'REGOLA',         sub: 'Piccola regolazione consigliata',         color: '#ff9800' },
      service: { label: 'REVISIONE',      sub: 'Necessita revisione / oliatura',          color: '#f44336' },
      skip:    { label: 'SCARTA',         sub: 'Non conveniente per il prezzo richiesto', color: '#9c27b0' }
    }
  }
};

/**
 * Valuta un singolo parametro e restituisce { grade, label, color }
 */
export function evaluateRate(value, profile) {
  const t = profile.rate;
  const abs = value;
  if (abs >= t.excellent.min && abs <= t.excellent.max) return { grade: 'excellent', ...t.excellent };
  if (abs >= t.good.min && abs <= t.good.max)           return { grade: 'good', ...t.good };
  if (abs >= t.acceptable.min && abs <= t.acceptable.max) return { grade: 'acceptable', ...t.acceptable };
  if (abs >= t.poor.min && abs <= t.poor.max)           return { grade: 'poor', ...t.poor };
  return { grade: 'critical', label: t.criticalLabel, color: t.criticalColor };
}

export function evaluateBeatError(value, profile) {
  const t = profile.beatError;
  const abs = Math.abs(value);
  if (abs <= t.excellent.max) return { grade: 'excellent', ...t.excellent };
  if (abs <= t.good.max)      return { grade: 'good', ...t.good };
  if (abs <= t.acceptable.max) return { grade: 'acceptable', ...t.acceptable };
  if (abs <= t.poor.max)      return { grade: 'poor', ...t.poor };
  return { grade: 'critical', label: t.criticalLabel, color: t.criticalColor };
}

export function evaluateAmplitude(value, profile) {
  const t = profile.amplitude;
  if (t.tooHigh && value >= t.tooHigh.min) return { grade: 'poor', ...t.tooHigh };
  if (value >= t.excellent.min && value <= t.excellent.max) return { grade: 'excellent', ...t.excellent };
  if (value >= t.good.min && value <= t.good.max)           return { grade: 'good', ...t.good };
  if (value >= t.acceptable.min && value <= t.acceptable.max) return { grade: 'acceptable', ...t.acceptable };
  if (value >= t.poor.min && value <= t.poor.max)           return { grade: 'poor', ...t.poor };
  return { grade: 'critical', label: t.criticalLabel, color: t.criticalColor };
}

/**
 * Calcola il verdetto finale basandosi sui tre parametri
 * Logica: il parametro peggiore trascina il verdetto
 */
export function computeVerdict(rateEval, beatEval, ampEval, profile) {
  const grades = ['excellent', 'good', 'acceptable', 'poor', 'critical'];
  const evals = [rateEval, beatEval, ampEval].filter(Boolean);
  if (evals.length === 0) return null;

  const worstIdx = Math.max(...evals.map(e => grades.indexOf(e.grade)));
  const worst = grades[worstIdx];

  if (worst === 'excellent' || worst === 'good') {
    return { ...profile.verdict.keep, worstGrade: worst };
  }
  if (worst === 'acceptable') {
    // Se beat error è il problema principale → regola
    if (beatEval && beatEval.grade === 'acceptable') {
      return { ...profile.verdict.adjust, worstGrade: worst, note: 'Beat error fuori registro' };
    }
    return { ...profile.verdict.adjust, worstGrade: worst };
  }
  if (worst === 'poor') {
    // Se ampiezza bassa → revisione (olio esaurito)
    if (ampEval && (ampEval.grade === 'poor' || ampEval.grade === 'critical')) {
      return { ...profile.verdict.service, worstGrade: worst, note: 'Ampiezza bassa: oliatura/revisione' };
    }
    return { ...profile.verdict.service, worstGrade: worst };
  }
  // critical
  return { ...profile.verdict.skip, worstGrade: worst };
}
