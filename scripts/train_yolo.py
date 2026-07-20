#!/usr/bin/env python3
"""
KHAAN NETRA — Custom YOLOv8 PPE Model Training Script

Prerequisites:
    pip install ultralytics roboflow

Usage:
    Run this script in a Google Colab notebook (with T4 GPU enabled) or locally.
    It downloads a pre-labeled PPE dataset from Roboflow, trains YOLOv8n,
    and exports it to TensorFlow.js format for the web dashboard.
"""

import os
import shutil
from ultralytics import YOLO

# ---------------------------------------------------------
# 1. DOWNLOAD DATASET (Roboflow)
# ---------------------------------------------------------
# Note: You will need a free Roboflow API key.
# Alternatively, point this to a local dataset in YOLO format.
def download_dataset():
    print("[*] Downloading PPE Dataset...")
    try:
        from roboflow import Roboflow
        
        # Replace with your own Roboflow API key and project
        rf = Roboflow(api_key="YOUR_ROBOFLOW_API_KEY")
        project = rf.workspace("roboflow-universe-projects").project("construction-site-safety")
        dataset = project.version(30).download("yolov8")
        return dataset.location
    except ImportError:
        print("[!] Roboflow package not installed. Skipping download.")
        print("[!] Please install with: pip install roboflow")
        print("[!] Or provide a local data.yaml path below.")
        # Fallback to standard yolov8 construction dataset if available
        return "construction-ppe.yaml"

# ---------------------------------------------------------
# 2. TRAIN YOLOv8
# ---------------------------------------------------------
def train_model(data_path):
    print(f"[*] Starting YOLOv8 training using data: {data_path}")
    
    # Load a pretrained Nano model (fastest for web browsers)
    model = YOLO("yolov8n.pt")
    
    # Train the model (adjust epochs based on time/dataset size)
    # Using 640x640 resolution (standard for web webcam feeds)
    results = model.train(
        data=data_path,
        epochs=30,      # Increase to 100+ for production
        imgsz=640,
        batch=16,
        project="khaan_netra_ppe",
        name="run_1"
    )
    
    # The best weights are saved here
    best_model_path = os.path.join("khaan_netra_ppe", "run_1", "weights", "best.pt")
    return best_model_path

# ---------------------------------------------------------
# 3. EXPORT TO TENSORFLOW.JS
# ---------------------------------------------------------
def export_to_tfjs(pt_model_path):
    print(f"[*] Exporting model to TensorFlow.js format: {pt_model_path}")
    
    model = YOLO(pt_model_path)
    
    # Export to tfjs format. This creates a folder ending in _web_model
    export_dir = model.export(format="tfjs", imgsz=640)
    print(f"[+] Export complete! TFJS model saved at: {export_dir}")
    
    # Suggest next steps
    print("\n" + "="*50)
    print("🚀 NEXT STEPS FOR KHAAN NETRA DASHBOARD:")
    print("1. Locate the exported folder (e.g., best_web_model/).")
    print("2. Copy ALL files inside it (model.json and .bin files).")
    print("3. Paste them into: khaan-netra/models/ppe-detector/")
    print("4. Update the CLASS_MAP in cv-scanner.js to match your dataset labels.")
    print("="*50 + "\n")

if __name__ == "__main__":
    print("=== KHAAN NETRA YOLOv8 TRAINING PIPELINE ===")
    
    # Step 1: Data
    dataset_path = download_dataset()
    
    # Step 2: Train
    # Note: If running locally without a GPU, you might want to change epochs to 5 for testing
    best_pt = train_model(dataset_path)
    
    # Step 3: Export
    print(f"[*] Exporting trained model {best_pt} to TFJS...")
    export_to_tfjs(best_pt)
