#!/usr/bin/env python3
"""Reproduce a qualified historical outline from a licensed published illustration.

Optional research dependencies: pypdf 6.10.0, Pillow 12.3.0, NumPy 2.3.5.
The source image is not redistributed. This is not a survey of surviving walls.
"""
import argparse
import hashlib
import io
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from pypdf import PdfReader

PDF_SHA256 = 'c1f353068e077689854de6483863a6b424c87fdc2e645eb9d66d078e1c9b12e0'
FIGURE_SHA256 = 'f2264629fc8decee973d95b83dc45de142e51539a7c5d05a284c48ec75014866'
SOURCE_URL = 'https://library.acadlore.com/TSDD/2024/1/1/TSDD_01.01_03.pdf'
# Pixel positions in the original 1502 x 682 Figure 3 image, not the PDF page.
TIES = [
    {'name': 'Kofar Ruwa', 'osmNode': 4395832587, 'pixel': [221, 151], 'lonLat': [8.5007849, 12.0266258]},
    {'name': 'Kofar Kabuga historic site', 'osmNode': 4395858272, 'pixel': [119, 474], 'lonLat': [8.4814435, 11.9873961]},
    {'name': 'Kofar Nassarawa', 'osmNode': 4395771247, 'pixel': [464, 449], 'lonLat': [8.5306777, 11.9908895]},
]
CHECKS = [
    {'name': 'Kano-Gwarzo / Kofar Mata road junction', 'osmNode': 1739882956, 'pixel': [357, 412], 'lonLat': [8.5164075, 11.9949034]},
    {'name': 'Goron Dutse hill symbol', 'osmNode': 501288980, 'pixel': [194, 363], 'lonLat': [8.4944515, 12.001466]},
]


GATE_REFERENCES = [{'name': 'Sabuwar Kofa', 'osmNode': 4395758513, 'lonLat': [8.5277106, 11.9843524]}, {'name': 'Kofar Mata', 'osmNode': 4395782139, 'lonLat': [8.5263759, 12.0008285]}, {'name': 'Kofar Wambai', 'osmNode': 4395802019, 'lonLat': [8.5213071, 12.0057027]}, {'name': 'Kofar Mazugal', 'osmNode': 4395809847, 'lonLat': [8.5180488, 12.0150715]}, {'name': 'Kofar Dawanau', 'osmNode': 4395838224, 'lonLat': [8.4920234, 12.0180327]}, {'name': 'Kofar Famfo', 'osmNode': 4395867323, 'lonLat': [8.4851611, 11.9789188]}, {'name': 'Kofar Gadan Kaya', 'osmNode': 4395889028, 'lonLat': [8.4957772, 11.9804248]}, {'name': 'Kofar Naisa', 'osmNode': 4395912648, 'lonLat': [8.5130959, 11.9824536]}, {'name': 'Kofar Dan Agundi', 'osmNode': 4395917911, 'lonLat': [8.5229826, 11.9814107]}]

def regenerate(pdf_path):
    data = pdf_path.read_bytes()
    if hashlib.sha256(data).hexdigest() != PDF_SHA256:
        raise ValueError('The pinned source PDF changed; review the figure and licence before updating')
    figure = PdfReader(io.BytesIO(data)).pages[5].images[0].data
    if hashlib.sha256(figure).hexdigest() != FIGURE_SHA256:
        raise ValueError('The extracted source figure changed')
    image = np.asarray(Image.open(io.BytesIO(figure)).convert('RGB'))
    if image.shape != (682, 1502, 3):
        raise ValueError('Unexpected figure dimensions')
    red, green, blue = (image[:, :, i].astype(int) for i in range(3))
    mask = (red > 170) & (green < 110) & (blue < 125) & (red > green * 1.7) & (red > blue * 1.7)
    mask[:, 744:] = False  # Exclude the photograph, not part of the adaptation.
    mask[:100] = False
    remaining = set(zip(*np.where(mask)))
    components = []
    while remaining:
        pending, component = [remaining.pop()], []
        while pending:
            y, x = pending.pop()
            component.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    candidate = (y + dy, x + dx)
                    if candidate in remaining:
                        remaining.remove(candidate)
                        pending.append(candidate)
        components.append(component)
    pixels = np.array(max(components, key=len))
    if len(pixels) != 5712:
        raise ValueError('The selected red outline changed')
    y, x = pixels[:, 0], pixels[:, 1]
    centre = [(x.min() + x.max()) / 2, (y.min() + y.max()) / 2]
    angles = (np.arctan2(y - centre[1], x - centre[0]) + math.pi) * 360 / math.pi
    trace = []
    for index in range(720):
        selected = (angles >= index) & (angles < index + 1)
        if selected.any():
            trace.append([round(float(np.median(x[selected])), 3), round(float(np.median(y[selected])), 3)])
    trace.append(trace[0])
    source_trace = np.array(trace)
    pixel_gap = 0.0
    for start, end in zip(source_trace, source_trace[1:]):
        for fraction in np.linspace(0, 1, 7):
            point = start + (end - start) * fraction
            pixel_gap = max(pixel_gap, float(np.min(np.hypot(x - point[0], y - point[1]))))
    if len(trace) != 721 or pixel_gap > 1.5:
        raise ValueError('The vector trace no longer follows the published red pixels')
    transform = np.linalg.solve(np.array([tie['pixel'] + [1] for tie in TIES]), np.array([tie['lonLat'] for tie in TIES]))
    coordinates = np.column_stack([source_trace, np.ones(len(source_trace))]) @ transform
    checks = []
    for check in CHECKS:
        projected = np.array(check['pixel'] + [1]) @ transform
        lon, lat = check['lonLat']
        residual = math.hypot((projected[0] - lon) * 108800, (projected[1] - lat) * 111320)
        checks.append({**check, 'residualMetres': round(residual, 1)})
    if any(check['residualMetres'] > 110 for check in checks):
        raise ValueError('Independent image controls no longer agree at illustration scale')
    reference_pixels = np.column_stack([x, y, np.ones(len(x))]) @ transform
    gates = []
    for gate in GATE_REFERENCES:
        lon, lat = gate['lonLat']
        distance = np.min(np.hypot((reference_pixels[:, 0] - lon) * 108800, (reference_pixels[:, 1] - lat) * 111320))
        gates.append({**gate, 'distanceToPublishedRedPixelsMetres': round(float(distance), 1)})
    metadata = {
        'url': SOURCE_URL, 'doi': '10.56578/tsdd010103', 'figure': '3(a)', 'year': 2024,
        'attribution': 'Adapted from Adamu et al. (2024), Figure 3(a); its combined caption credits Yusuf et al. (2023a).',
        'licence': 'CC BY 4.0', 'controlLicence': 'OpenStreetMap contributors, ODbL 1.0',
        'pdfSha256': PDF_SHA256, 'figureSha256': FIGURE_SHA256,
        'qualification': 'Published historical outline, approximately georeferenced. Not a current standing-wall survey. Upstream authorship of the red overlay is not independently established.',
        'ties': TIES, 'independentChecks': checks,
        'otherGateComparisons': gates,
        'sourcePixelDistanceMaximum': round(pixel_gap, 4),
    }
    header = '/** Generated from a licensed historical illustration. Run scripts/geo/refresh-kano-wall.py; no basemap or photograph is bundled. */\n'
    text = header + 'export const KANO_WALL_SOURCE = ' + json.dumps(metadata, ensure_ascii=False, indent=2) + ' as const\n'
    text += 'export const KANO_HISTORIC_WALL = ' + json.dumps(np.round(coordinates, 7).tolist(), separators=(',', ':')) + ' as const\n'
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pdf', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    target = Path(__file__).resolve().parents[2] / 'src/map3d/geo/data/kano-wall.ts'
    output = regenerate(args.pdf)
    if args.check:
        if target.read_text() != output:
            raise ValueError('Generated Kano historical wall differs')
    else:
        target.write_text(output)
    print(f'{target.name}: {"check ok" if args.check else "written"}, sha256 {hashlib.sha256(output.encode()).hexdigest()}, 721 source-derived points')


if __name__ == '__main__':
    main()
