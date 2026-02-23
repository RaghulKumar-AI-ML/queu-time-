from flask import Flask, request, jsonify
from flask_cors import CORS
import cv2
import numpy as np
from datetime import datetime
import base64
import io
from PIL import Image

app = Flask(__name__)
CORS(app)

class PeopleCounter:
    """Count people in queue images using computer vision"""
    
    def __init__(self):
        # Load pre-trained HOG person detector
        self.hog = cv2.HOGDescriptor()
        self.hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        
    def decode_image(self, image_data):
        """Decode base64 image data"""
        try:
            if ',' in image_data:
                image_data = image_data.split(',')[1]
            
            image_bytes = base64.b64decode(image_data)
            pil_image = Image.open(io.BytesIO(image_bytes))
            opencv_image = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
            
            return opencv_image
        except Exception as e:
            print(f"Error decoding image: {e}")
            return None
    
    def count_people(self, image):
        """Count people in image using HOG detector"""
        try:
            height, width = image.shape[:2]
            if width > 800:
                scale = 800 / width
                new_width = 800
                new_height = int(height * scale)
                image = cv2.resize(image, (new_width, new_height))
            
            (people, weights) = self.hog.detectMultiScale(
                image,
                winStride=(4, 4),
                padding=(8, 8),
                scale=1.05,
                useMeanshiftGrouping=False
            )
            
            people_count = len(people)
            
            if people_count > 0:
                boxes = np.array([[x, y, x + w, y + h] for (x, y, w, h) in people])
                people_count = len(self.non_max_suppression(boxes, 0.3))
            
            return people_count
            
        except Exception as e:
            print(f"Error counting people: {e}")
            return None
    
    def non_max_suppression(self, boxes, overlap_thresh):
        """Remove overlapping bounding boxes"""
        if len(boxes) == 0:
            return []
        
        boxes = boxes.astype(float)
        pick = []
        
        x1 = boxes[:, 0]
        y1 = boxes[:, 1]
        x2 = boxes[:, 2]
        y2 = boxes[:, 3]
        
        area = (x2 - x1 + 1) * (y2 - y1 + 1)
        idxs = np.argsort(y2)
        
        while len(idxs) > 0:
            last = len(idxs) - 1
            i = idxs[last]
            pick.append(i)
            
            xx1 = np.maximum(x1[i], x1[idxs[:last]])
            yy1 = np.maximum(y1[i], y1[idxs[:last]])
            xx2 = np.minimum(x2[i], x2[idxs[:last]])
            yy2 = np.minimum(y2[i], y2[idxs[:last]])
            
            w = np.maximum(0, xx2 - xx1 + 1)
            h = np.maximum(0, yy2 - yy1 + 1)
            
            overlap = (w * h) / area[idxs[:last]]
            
            idxs = np.delete(idxs, np.concatenate(([last], np.where(overlap > overlap_thresh)[0])))
        
        return boxes[pick].astype(int)
    
    def estimate_wait_time(self, people_count, avg_service_time=15):
        """Estimate wait time based on people count"""
        base_wait = people_count * avg_service_time
        variance = np.random.randint(-2, 3)
        estimated_wait = max(0, base_wait + variance)
        
        return estimated_wait

counter = PeopleCounter()

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'healthy',
        'service': 'People Counter Service',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/count-people', methods=['POST'])
def count_people_endpoint():
    """Count people in uploaded queue image"""
    try:
        data = request.json
        
        if not data or 'image' not in data:
            return jsonify({
                'success': False,
                'message': 'No image provided'
            }), 400
        
        image = counter.decode_image(data['image'])
        
        if image is None:
            return jsonify({
                'success': False,
                'message': 'Failed to decode image'
            }), 400
        
        people_count = counter.count_people(image)
        
        if people_count is None:
            return jsonify({
                'success': False,
                'message': 'Failed to count people'
            }), 500
        
        avg_service_time = data.get('avgServiceTime', 15)
        estimated_wait = counter.estimate_wait_time(people_count, avg_service_time)
        
        return jsonify({
            'success': True,
            'data': {
                'peopleCount': people_count,
                'estimatedWaitTime': estimated_wait,
                'avgServiceTime': avg_service_time,
                'timestamp': datetime.now().isoformat(),
                'confidence': 'medium' if people_count > 0 else 'low'
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

if __name__ == '__main__':
    print("🚀 People Counter Service Starting...")
    print("👥 Computer Vision queue analysis ready")
    print("🔍 Service running on http://localhost:5001")
    app.run(host='0.0.0.0', port=5001, debug=True)
