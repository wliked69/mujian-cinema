package com.screenroom.app;

/** Pure geometry so fold transitions can be tested without a device/emulator. */
public final class FoldLayoutCalculator {
    public enum Mode { FULL, BOOK, TABLETOP }
    public static final class Box {
        public final int left, top, right, bottom;
        public Box(int left, int top, int right, int bottom) {
            this.left = left; this.top = top; this.right = right; this.bottom = bottom;
        }
        public int width() { return right - left; }
        public int height() { return bottom - top; }
    }
    public static final class Layout {
        public final Box main, companion;
        public final Mode mode;
        private Layout(Box main, Box companion, Mode mode) {
            this.main = main; this.companion = companion; this.mode = mode;
        }
    }
    private FoldLayoutCalculator() {}

    public static Layout calculate(int width, int height, Box hinge, boolean vertical, boolean separating,
                                   int gapPadding, int minimumPane) {
        width = Math.max(0, width); height = Math.max(0, height);
        Layout full = new Layout(new Box(0, 0, width, height), null, Mode.FULL);
        if (hinge == null || !separating || width == 0 || height == 0) return full;
        int start = vertical ? hinge.left : hinge.top;
        int end = vertical ? hinge.right : hinge.bottom;
        int limit = vertical ? width : height;
        if (end < start || start <= 0 || end >= limit) return full;
        // A feature in another split-screen window must not split this window.
        if (vertical ? hinge.top > 0 || hinge.bottom < height : hinge.left > 0 || hinge.right < width) return full;
        int before = Math.max(0, start - Math.max(0, gapPadding));
        int after = Math.min(limit, end + Math.max(0, gapPadding));
        Box first = vertical ? new Box(0, 0, before, height) : new Box(0, 0, width, before);
        Box second = vertical ? new Box(after, 0, width, height) : new Box(0, after, width, height);
        int firstSize = vertical ? first.width() : first.height();
        int secondSize = vertical ? second.width() : second.height();
        if (firstSize < minimumPane || secondSize < minimumPane) {
            // Still avoid the hinge when one safe pane is too small for controls.
            return new Layout(firstSize >= secondSize ? first : second, null, vertical ? Mode.BOOK : Mode.TABLETOP);
        }
        return new Layout(first, second, vertical ? Mode.BOOK : Mode.TABLETOP);
    }
}
