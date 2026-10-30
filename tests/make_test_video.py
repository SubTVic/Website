"""Generates a synthetic foosball video (Y4M) for testing without a real table.

Sequence: ball rests in the middle -> ball control -> shot into the right goal ->
ball gone -> restart -> shot at the left goal that gets saved -> ball control.

Usage: python3 tests/make_test_video.py output.y4m
"""
import sys
import numpy as np

W, H, FPS = 640, 360, 30
CORNERS = [(80, 40), (560, 50), (600, 320), (40, 310)]  # field corners in the image (clockwise)
BALL_RGB = (255, 140, 0)
BALL_R = 7


def homography(src, dst):
    A, b = [], []
    for (x, y), (X, Y) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.append(X)
        A.append([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.append(Y)
    h = np.linalg.solve(np.array(A, float), np.array(b, float))
    return np.append(h, 1).reshape(3, 3)


F2I = homography([(0, 0), (1, 0), (1, 1), (0, 1)], CORNERS)


def to_img(u, v):
    x, y, w = F2I @ np.array([u, v, 1.0])
    return x / w, y / w


def lerp(a, b, k):
    return a + (b - a) * k


def ball_at(t):
    """Ball position (u, v) at time t, or None when invisible."""
    if t < 3.0:
        return 0.5, 0.5                       # resting in the middle
    if t < 4.5:
        return 0.55 + 0.01 * np.sin(t * 6), 0.5 + 0.08 * np.sin(t * 3)  # control on the five-bar
    if t < 4.65:
        k = min(1, (t - 4.5) / 0.12)          # shot: 0.55 -> 1.02 in 0.12 s (~17 km/h)
        return lerp(0.55, 1.02, k), 0.5
    if t < 7.0:
        return None                           # in the goal
    if t < 9.0:
        return 0.5, 0.45 + 0.03 * np.sin(t * 2)  # restart, slow
    if t < 9.07:
        k = (t - 9.0) / 0.07                  # shot to the left (~23 km/h)
        return lerp(0.5, 0.12, k), 0.5
    if t < 9.32:
        k = (t - 9.07) / 0.25                   # save, ball bounces back
        return lerp(0.12, 0.35, k), lerp(0.5, 0.4, k)
    if t < 12.0:
        return 0.35 + 0.01 * np.sin(t * 5), 0.4   # control
    return 0.35, 0.4


def background():
    img = np.zeros((H, W, 3), np.uint8)
    img[:] = (35, 35, 40)
    yy, xx = np.mgrid[0:H, 0:W]
    I2F = np.linalg.inv(F2I)
    pts = np.stack([xx, yy, np.ones_like(xx)], -1).astype(float) @ I2F.T
    u, v = pts[..., 0] / pts[..., 2], pts[..., 1] / pts[..., 2]
    field = (u >= 0) & (u <= 1) & (v >= 0) & (v <= 1)
    img[field] = (30, 120, 50)
    for i in range(8):                        # rods
        rod = field & (np.abs(u - (i + 0.5) / 8) < 0.004)
        img[rod] = (170, 170, 175)
    return img


def rgb_to_yuv420(img):
    f = img.astype(float)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    u = -0.169 * r - 0.331 * g + 0.5 * b + 128
    v = 0.5 * r - 0.419 * g - 0.081 * b + 128
    sub = lambda c: c.reshape(H // 2, 2, W // 2, 2).mean((1, 3))
    return [np.clip(c, 0, 255).astype(np.uint8) for c in (y, sub(u), sub(v))]


def main(path):
    bg = background()
    yy, xx = np.mgrid[0:H, 0:W]
    with open(path, 'wb') as out:
        out.write(f'YUV4MPEG2 W{W} H{H} F{FPS}:1 Ip A1:1 C420jpeg\n'.encode())
        for n in range(int(13 * FPS)):
            frame = bg.copy()
            pos = ball_at(n / FPS)
            if pos:
                cx, cy = to_img(*pos)
                frame[(xx - cx) ** 2 + (yy - cy) ** 2 <= BALL_R ** 2] = BALL_RGB
            out.write(b'FRAME\n')
            for plane in rgb_to_yuv420(frame):
                out.write(plane.tobytes())


if __name__ == '__main__':
    main(sys.argv[1])
