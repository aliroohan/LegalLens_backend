import sys
import cv2
from services.lighting_shadow_service import run_lighting_shadow


sys.path.insert(0, r"D:\Semester 7\FYP1\LegalLens_backend\Image-forensics\src")

path = sys.argv[1]  # image path
with open(path, "rb") as f:
    image_bytes = f.read()

result = run_lighting_shadow(image_bytes)

print("Inconclusive:", result.get("inconclusive"))
print("Score:", result["confidence"])
for line in result["findings"]:
    print(" -", line)

out = path.rsplit(".", 1)[0] + "_lighting_out.png"
cv2.imwrite(out, result["visualization"])
print("Saved visualization to:", out)