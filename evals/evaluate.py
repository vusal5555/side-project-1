import json
from pathlib import Path

from side_project_v1.app.services.room_booking_agent import extract_room_bookings

dataset_path = Path(__file__).with_name("dataset.json")
dataset = json.loads(dataset_path.read_text())

correct = 0

for case in dataset:
    prediction = extract_room_bookings(case["email"], case["email_date"])

    actual = case["expected"]
    predict = prediction.model_dump(mode="json")

    passed = actual == predict
    if passed:
        correct += 1

    if not passed:
        print("Expected:", actual)
        print("Prediction:  ", predict)

accuracy = correct / len(dataset) * 100

print(f"\nExact-match accuracy: {accuracy:.1f}%")
