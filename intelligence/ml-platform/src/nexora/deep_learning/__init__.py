"""NEXORA Deep Learning Module.

Unified deep learning intelligence across:
- Mobility: Spatio-temporal GNN, conformal ETA, trajectory transformer, vision defect detection.
- Finance: Neural transaction classifier, deep SVDD anomaly detector, DeepAR cash-flow forecaster, regime switching.
- Voice: Multilingual telephony Whisper ASR adapter, neural speaker diarizer, BGE-M3 dense retrieval, urgency detector.
- Cross-cutting: Multi-modal user-twin fusion & continuous learning evaluation harness.
"""

from __future__ import annotations

from typing import Any

from nexora.deep_learning.evaluation import (
    DriftDetector,
    ModelEvaluationHarness,
    ShadowModeEvaluator,
)
from nexora.deep_learning.finance import (
    DeepARCashFlowForecaster,
    DeepSVDDAnomalyDetector,
    GNNRiskPropagator,
    NeuralDocIntelligence,
    NeuralTransactionClassifier,
    RegimeSwitchingRiskModel,
)
from nexora.deep_learning.mobility import (
    BehavioralDemandTFT,
    DeepConformalETAPredictor,
    NeuralRoadVision,
    OfflineRLPolicySimulator,
    SpatioTemporalGNN,
    TrajectoryTransformer,
    TripAnomalyAutoencoder,
)
from nexora.deep_learning.multimodal import MultiModalUserTwinFusion
from nexora.deep_learning.voice import (
    AcousticUrgencyEmotionDetector,
    CrossEncoderReranker,
    DenseMemoryRetriever,
    NeuralSpeakerDiarizer,
    WhisperTelephonyASRAdapter,
)


class DeepLearningHub:
    """Unified container for all production deep learning models."""

    def __init__(self) -> None:
        # Mobility
        self.st_gnn = SpatioTemporalGNN()
        self.conformal_eta = DeepConformalETAPredictor()
        self.trajectory_transformer = TrajectoryTransformer()
        self.trip_autoencoder = TripAnomalyAutoencoder()
        self.road_vision = NeuralRoadVision()
        self.demand_tft = BehavioralDemandTFT()
        self.rl_policy = OfflineRLPolicySimulator()

        # Finance
        self.txn_classifier = NeuralTransactionClassifier()
        self.spend_svdd = DeepSVDDAnomalyDetector()
        self.cashflow_deepar = DeepARCashFlowForecaster()
        self.regime_risk = RegimeSwitchingRiskModel()
        self.gnn_risk = GNNRiskPropagator()
        self.doc_intel = NeuralDocIntelligence()

        # Voice
        self.whisper_telephony = WhisperTelephonyASRAdapter()
        self.speaker_diarizer = NeuralSpeakerDiarizer()
        self.dense_retriever = DenseMemoryRetriever()
        self.cross_reranker = CrossEncoderReranker()
        self.urgency_detector = AcousticUrgencyEmotionDetector()

        # Cross-cutting & Evaluation
        self.multimodal_fusion = MultiModalUserTwinFusion()
        self.drift_detector = DriftDetector()
        self.shadow_evaluator = ShadowModeEvaluator()
        self.evaluation_harness = ModelEvaluationHarness()

    def get_status(self) -> dict[str, Any]:
        return {
            "status": "online",
            "models_loaded": 16,
            "architecture_families": [
                "Spatio-Temporal Graph WaveNet / DCRNN",
                "Conformal Deep Quantile Ensemble",
                "Trajectory Transformer (Multi-Head Self-Attention)",
                "Deep SVDD & Hypersphere Anomaly",
                "MiniLM-CharTransformer NLP Classifier",
                "DeepAR Probabilistic Sequence Forecaster",
                "Hidden Markov Regime Switching + Factor Tilts",
                "Wav2Vec2 / HuBERT Acoustic Affect Detector",
                "BGE-M3 Dense Retrieval & Cross-Encoder",
                "Multi-Modal Cross-Attention User Twin",
                "Kolmogorov-Smirnov Continuous Drift Detector",
            ],
        }


hub = DeepLearningHub()

__all__ = [
    "hub",
    "DeepLearningHub",
    "SpatioTemporalGNN",
    "DeepConformalETAPredictor",
    "TrajectoryTransformer",
    "TripAnomalyAutoencoder",
    "NeuralRoadVision",
    "BehavioralDemandTFT",
    "OfflineRLPolicySimulator",
    "NeuralTransactionClassifier",
    "DeepSVDDAnomalyDetector",
    "DeepARCashFlowForecaster",
    "RegimeSwitchingRiskModel",
    "GNNRiskPropagator",
    "NeuralDocIntelligence",
    "WhisperTelephonyASRAdapter",
    "NeuralSpeakerDiarizer",
    "DenseMemoryRetriever",
    "CrossEncoderReranker",
    "AcousticUrgencyEmotionDetector",
    "MultiModalUserTwinFusion",
    "DriftDetector",
    "ShadowModeEvaluator",
    "ModelEvaluationHarness",
]
