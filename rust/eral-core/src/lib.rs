//! ERAL core — confidence formula and ternary gating, mirroring
//! `src/confidence.ts` and `src/types.ts`. Compiled to `wasm32-unknown-unknown`
//! for sub-2ms in-browser scoring; DOM manipulation itself stays in JS/web-sys
//! since WASM has no direct DOM access.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Local-horizon snapshot of a single DOM/network observation (500ms-3s window).
#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DomState {
    pub observed_at: f64,
    pub mutation_count: u32,
    pub layout_shift_score: f64,
    pub pending_network_requests: u32,
    pub ms_since_network_idle: f64,
    pub interrupt_present: bool,
    pub target_element_ready: bool,
}

/// The three independent sub-scores that compose the confidence formula.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConfidenceVector {
    pub s_dom: f64,
    pub r_inter: f64,
    pub n_state: f64,
}

/// Relative weights applied to the three sub-scores; expected to sum to 1.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConfidenceWeights {
    pub w_dom: f64,
    pub w_inter: f64,
    pub w_state: f64,
}

impl Default for ConfidenceWeights {
    fn default() -> Self {
        Self {
            w_dom: 0.4,
            w_inter: 0.3,
            w_state: 0.3,
        }
    }
}

pub const SAFE_THRESHOLD: f64 = 0.85;
pub const UNCERTAIN_THRESHOLD: f64 = 0.40;

/// Ternary classification of the composed confidence score.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RiskClass {
    Safe,
    Uncertain,
    Risky,
}

/// Confidence + classification + the sub-scores that produced them.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GateDecision {
    pub confidence: f64,
    pub risk_class: RiskClass,
    pub vector: ConfidenceVector,
}

fn clamp01(v: f64) -> f64 {
    if v.is_nan() {
        0.0
    } else {
        v.max(0.0).min(1.0)
    }
}

/// Derives S_dom/R_inter/N_state from a raw DOM observation. See
/// `src/confidence.ts::deriveConfidenceVector` for the canonical rationale.
pub fn derive_confidence_vector(dom: &DomState) -> ConfidenceVector {
    let s_dom = clamp01(
        1.0 - clamp01(dom.mutation_count as f64 / 20.0) * 0.6
            - clamp01(dom.layout_shift_score) * 0.4,
    );

    let r_inter = if dom.interrupt_present || !dom.target_element_ready {
        1.0
    } else {
        0.0
    };

    let n_state = if dom.pending_network_requests > 0 {
        clamp01(dom.ms_since_network_idle / 3000.0) * 0.3
    } else {
        clamp01(dom.ms_since_network_idle / 1000.0)
    };

    ConfidenceVector {
        s_dom,
        r_inter,
        n_state,
    }
}

/// C = wDom * S_dom + wInter * (1 - R_inter) + wState * N_state, clamped to [0, 1].
pub fn compute_confidence(vector: &ConfidenceVector, weights: &ConfidenceWeights) -> f64 {
    clamp01(
        weights.w_dom * clamp01(vector.s_dom)
            + weights.w_inter * (1.0 - clamp01(vector.r_inter))
            + weights.w_state * clamp01(vector.n_state),
    )
}

/// SAFE >= 0.85, UNCERTAIN in [0.40, 0.85), RISKY < 0.40.
pub fn classify(confidence: f64) -> RiskClass {
    if confidence >= SAFE_THRESHOLD {
        RiskClass::Safe
    } else if confidence >= UNCERTAIN_THRESHOLD {
        RiskClass::Uncertain
    } else {
        RiskClass::Risky
    }
}

/// Runs the full B-section logic matrix: observation -> vector -> score -> class.
pub fn gate(dom: &DomState, weights: &ConfidenceWeights) -> GateDecision {
    let vector = derive_confidence_vector(dom);
    let confidence = compute_confidence(&vector, weights);
    let risk_class = classify(confidence);
    GateDecision {
        confidence,
        risk_class,
        vector,
    }
}

/// WASM entry point: takes a JS `DomState` object (and optional
/// `ConfidenceWeights`, defaulting to `ConfidenceWeights::default()`),
/// returns a JS `GateDecision` object. This is the only exported symbol —
/// mirrors the single-entry-point constraint from the ERAL prompt.
#[wasm_bindgen(js_name = eralGate)]
pub fn eral_gate(dom_state: JsValue, weights: JsValue) -> Result<JsValue, JsValue> {
    let dom: DomState =
        serde_wasm_bindgen::from_value(dom_state).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let weights: ConfidenceWeights = if weights.is_undefined() || weights.is_null() {
        ConfidenceWeights::default()
    } else {
        serde_wasm_bindgen::from_value(weights).map_err(|e| JsValue::from_str(&e.to_string()))?
    };

    let decision = gate(&dom, &weights);
    serde_wasm_bindgen::to_value(&decision).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn safe_dom() -> DomState {
        DomState {
            observed_at: 0.0,
            mutation_count: 0,
            layout_shift_score: 0.0,
            pending_network_requests: 0,
            ms_since_network_idle: 1200.0,
            interrupt_present: false,
            target_element_ready: true,
        }
    }

    fn risky_dom() -> DomState {
        DomState {
            observed_at: 0.0,
            mutation_count: 14,
            layout_shift_score: 0.4,
            pending_network_requests: 3,
            ms_since_network_idle: 50.0,
            interrupt_present: true,
            target_element_ready: false,
        }
    }

    #[test]
    fn safe_dom_state_gates_safe() {
        let decision = gate(&safe_dom(), &ConfidenceWeights::default());
        assert_eq!(decision.risk_class, RiskClass::Safe);
        assert!(decision.confidence >= SAFE_THRESHOLD);
    }

    #[test]
    fn risky_dom_state_gates_risky() {
        let decision = gate(&risky_dom(), &ConfidenceWeights::default());
        assert_eq!(decision.risk_class, RiskClass::Risky);
        assert!(decision.confidence < UNCERTAIN_THRESHOLD);
    }

    #[test]
    fn confidence_is_always_within_unit_interval() {
        for dom in [safe_dom(), risky_dom()] {
            let decision = gate(&dom, &ConfidenceWeights::default());
            assert!((0.0..=1.0).contains(&decision.confidence));
        }
    }

    #[test]
    fn interrupt_present_forces_max_risk_component() {
        let mut dom = safe_dom();
        dom.interrupt_present = true;
        let vector = derive_confidence_vector(&dom);
        assert_eq!(vector.r_inter, 1.0);
    }

    #[test]
    fn classify_thresholds_match_spec() {
        assert_eq!(classify(0.85), RiskClass::Safe);
        assert_eq!(classify(0.849), RiskClass::Uncertain);
        assert_eq!(classify(0.40), RiskClass::Uncertain);
        assert_eq!(classify(0.399), RiskClass::Risky);
    }
}
