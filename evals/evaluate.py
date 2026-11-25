import json
from pathlib import Path

from munkres import Munkres

from side_project_v1.app.services.room_booking_agent import extract_room_bookings

FIELDS = [
    "arrival_date",
    "departure_date",
    "num_rooms",
    "num_adults",
    "num_children",
    "children_ages",
    "room_type",
]

dataset_path = Path(__file__).with_name("dataset.json")
dataset = json.loads(dataset_path.read_text())

correct_emails = 0
field_correct = {field: 0 for field in FIELDS}
total_blocks = 0

for index, case in enumerate(dataset, start=1):
    prediction = extract_room_bookings(case["email"], case["email_date"])

    expected = case["expected"]["reservations"]
    predicted = prediction.model_dump(mode="json")["reservations"]

    # Match reservation blocks regardless of order.
    size = max(len(expected), len(predicted))
    total_blocks += size

    cost_matrix = [
        [
            sum(expected[i][f] != predicted[j][f] for f in FIELDS)
            if i < len(expected) and j < len(predicted)
            else len(FIELDS)
            for j in range(size)
        ]
        for i in range(size)
    ]

    matches = Munkres().compute(cost_matrix) if size else []

    passed = len(expected) == len(predicted) and all(
        cost_matrix[i][j] == 0 for i, j in matches
    )

    if passed:
        correct_emails += 1
    else:
        print(f"\nEmail #{index} FAILED")
        print("Expected:", expected)
        print("Predicted:", predicted)

    for i, j in matches:
        if i < len(expected) and j < len(predicted):
            for field in FIELDS:
                if expected[i][field] == predicted[j][field]:
                    field_correct[field] += 1

    print(f"Email #{index}: {'PASS' if passed else 'FAIL'}")

print("\n--- EVALUATION RESULTS ---")

accuracy = correct_emails / len(dataset) * 100
print(f"Exact-match accuracy: {accuracy:.1f}%")

print("\nField-level accuracy:")
for field in FIELDS:
    score = field_correct[field] / total_blocks * 100 if total_blocks else 0
    print(f"{field}: {score:.1f}%")
