package com.screenroom.app;

import org.junit.Test;
import static org.junit.Assert.*;
import com.screenroom.app.FoldLayoutCalculator.Box;
import com.screenroom.app.FoldLayoutCalculator.Layout;
import com.screenroom.app.FoldLayoutCalculator.Mode;

public class FoldLayoutCalculatorTest {
    private Layout layout(int w, int h, Box hinge, boolean vertical, boolean separating) {
        return FoldLayoutCalculator.calculate(w, h, hinge, vertical, separating, 6, 120);
    }
    private void box(Box actual, int l, int t, int r, int b) {
        assertEquals(l, actual.left); assertEquals(t, actual.top);
        assertEquals(r, actual.right); assertEquals(b, actual.bottom);
    }
    @Test public void outerScreenUsesEntireWindow() {
        Layout x = layout(390, 820, null, false, false);
        assertEquals(Mode.FULL, x.mode); assertNull(x.companion); box(x.main, 0, 0, 390, 820);
    }
    @Test public void flatExpandedScreenIsNotUnnecessarilySplit() {
        Layout x = layout(1000, 840, new Box(500, 0, 500, 840), true, false);
        assertEquals(Mode.FULL, x.mode); box(x.main, 0, 0, 1000, 840);
    }
    @Test public void bookHingeHasSafeMarginsOnBothSides() {
        Layout x = layout(1000, 840, new Box(490, -24, 510, 880), true, true);
        assertEquals(Mode.BOOK, x.mode);
        box(x.main, 0, 0, 484, 840); box(x.companion, 516, 0, 1000, 840);
    }
    @Test public void halfOpenZeroWidthCreaseStillSplits() {
        Layout x = layout(800, 900, new Box(400, 0, 400, 900), true, true);
        assertEquals(Mode.BOOK, x.mode);
        box(x.main, 0, 0, 394, 900); box(x.companion, 406, 0, 800, 900);
    }
    @Test public void tabletopVideoStaysAboveHorizontalHinge() {
        Layout x = layout(900, 1000, new Box(-10, 480, 920, 500), false, true);
        assertEquals(Mode.TABLETOP, x.mode);
        box(x.main, 0, 0, 900, 474); box(x.companion, 0, 506, 900, 1000);
    }
    @Test public void hingeOutsideSplitScreenWindowIsIgnored() {
        assertEquals(Mode.FULL, layout(390, 800, new Box(500, 0, 520, 800), true, true).mode);
        assertEquals(Mode.FULL, layout(390, 800, new Box(-50, 0, -30, 800), true, true).mode);
        assertEquals(Mode.FULL, layout(390, 800, new Box(190, 300, 200, 800), true, true).mode);
    }
    @Test public void veryNarrowPaneUsesLargerSafeSideNotHinge() {
        Layout x = layout(600, 800, new Box(50, 0, 70, 800), true, true);
        assertNull(x.companion); box(x.main, 76, 0, 600, 800);
        x = layout(600, 800, new Box(550, 0, 570, 800), true, true);
        assertNull(x.companion); box(x.main, 0, 0, 544, 800);
    }
    @Test public void emptyWindowNeverHasNegativeBounds() {
        Layout x = layout(-1, 0, new Box(10, 0, 10, 0), true, true);
        box(x.main, 0, 0, 0, 0); assertNull(x.companion);
    }
    @Test public void foldsCanReturnToFullLayout() {
        assertEquals(Mode.TABLETOP, layout(900, 1000, new Box(0, 500, 900, 500), false, true).mode);
        assertEquals(Mode.FULL, layout(900, 1000, null, false, false).mode);
    }
    @Test public void invariantsForWindowSizesAndHingePositions() {
        for (int width : new int[]{320, 390, 600, 840, 1200, 1800}) {
            for (int height : new int[]{300, 780, 1100}) {
                for (boolean vertical : new boolean[]{true, false}) {
                    int limit = vertical ? width : height;
                    for (int at : new int[]{30, limit / 2, limit - 30}) {
                        Box hinge = vertical ? new Box(at, 0, at + 8, height) : new Box(0, at, width, at + 8);
                        Layout x = layout(width, height, hinge, vertical, true);
                        for (Box pane : new Box[]{x.main, x.companion}) {
                            if (pane == null) continue;
                            assertTrue(pane.left >= 0 && pane.top >= 0 && pane.right <= width && pane.bottom <= height);
                            assertTrue(pane.width() > 0 && pane.height() > 0);
                            assertTrue(vertical ? pane.right <= hinge.left || pane.left >= hinge.right
                                    : pane.bottom <= hinge.top || pane.top >= hinge.bottom);
                        }
                    }
                }
            }
        }
    }
}
