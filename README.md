# WatchGrapher

**Cronocomparatore / Timegrapher PWA** per orologi meccanici — ottimizzato per microfono TGBC USB/Type-C.

---

## Funzionalità

| Parametro | Descrizione |
|-----------|-------------|
| **Rate** | Scarto giornaliero (sec/giorno), con segno |
| **Beat Error** | Differenza tick-tock in millisecondi |
| **Ampiezza** | Angolo oscillazione bilanciere in gradi |
| **BPH** | Rilevamento automatico battiti/ora |
| **Paper Strip** | Grafico deviazione nel tempo, stile timegrapher vintage |
| **Verdetto** | TIENI / REGOLA / REVISIONE / SCARTA |

---

## Profili di valutazione

- **☭ URSS / Russia** — tolleranze larghe (±30 s/giorno accettabile), tipiche produzione sovietica
- **⌚ Svizzero / Giapponese / Moderno** — standard contemporanei (±5 s/giorno ottimo)

---

## Microfono TGBC

Il TGBC è un dispositivo piezoelettrico USB con amplificatore integrato che si presenta al sistema operativo come **sorgente audio standard**. Collegalo via:
- cavo USB-C → USB-C (telefono/tablet moderno)
- cavo USB-C → USB-A + adattatore OTG (smartphone Android)
- cavo USB-A → porta USB PC/Mac

L'app lo rileva automaticamente cercando "USB Audio" nella lista dispositivi (evidenziato con ★).

---

## Struttura progetto

```
watchgrapher/
├── index.html          ← Entry point PWA
├── manifest.json       ← PWA manifest (installabile)
├── sw.js               ← Service Worker (offline)
├── css/
│   └── app.css         ← Stile vintage LCD verde
├── js/
│   ├── app.js          ← Orchestratore principale
│   ├── audio.js        ← Gestione microfono Web Audio API
│   ├── analyzer.js     ← Algoritmo tick detection + calcoli
│   ├── calibration.js  ← Calibrazione via NTP atomico
│   ├── profiles.js     ← Profili Soviet vs Modern + verdetti
│   └── ui.js           ← Rendering UI + paper strip canvas
└── data/
    └── lift-angles.json ← DB lift angle per ~30 calibri
```

### Principio di modularità
Ogni file ha una responsabilità unica. Per modificare:
- **Soglie di valutazione** → `js/profiles.js`
- **Algoritmo rilevamento** → `js/analyzer.js`
- **Aggiungere calibri** → `data/lift-angles.json`
- **Aspetto grafico** → `css/app.css`

---

## Algoritmo

### Rate
```
intervallo_teorico = 3600 / BPH
scarto = (intervallo_misurato - intervallo_teorico) / intervallo_teorico × 86400
```

### Ampiezza
```
A = (3600 × lift_angle) / (ΔT × π × BPH)
```
dove `ΔT` = intervallo P1-P3 del tick (secondi).

### Beat Error
```
beat_error = (intervallo_tick_tock - intervallo_teorico/2) × 1000
```

Tutti i parametri usano **trimmed mean** (rimozione 20% valori estremi) per robustezza.

---

## Deploy su GitHub Pages

```bash
git init
git add .
git commit -m "WatchGrapher v1.0"
git remote add origin https://github.com/TUO_UTENTE/watchgrapher.git
git push -u origin main
```

Poi su GitHub: Settings → Pages → Source: main / root.

L'app sarà disponibile su `https://TUO_UTENTE.github.io/watchgrapher/`

> ⚠️ GitHub Pages richiede HTTPS — necessario per Web Audio API e microfono.

---

## Limitazioni note

- Il calcolo dell'ampiezza richiede che il TGBC catturi chiaramente tutti e 3 gli impulsi del tick. Con orologi silenziosi potrebbe mostrare `—`.
- Il beat error su orologi lenti (18000 BPH) è meno preciso che su orologi veloci.
- Su iOS Safari, la Web Audio API può richiedere un tap utente per attivarsi — normale.

---

## Calibri sovietici inclusi

Chaika 13xx, Luch 18xx/22xx, Molnija 36xx, Pobeda K26, Poljot 2609/2612/2614/3017/3133, Raketa 26xx, Slava 16xx/24xx/5498, Vostok 22xx/24xx/28xx, Zarja 15xx/16xx/20xx.

Source: [WatchUSeek Russian Watch Lift Angles](https://www.watchuseek.com/threads/russian-watch-lift-angles.864760/)
