#include <napi.h>
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <dispatch/dispatch.h>
#include <vector>

@interface CodexBadgeView : NSView
@property(nonatomic, copy) NSString *badgeLabel;
@property(nonatomic, strong) NSColor *badgeColor;
@end

@implementation CodexBadgeView
- (void)drawRect:(NSRect)dirtyRect {
  (void)dirtyRect;
  NSRect bounds = self.bounds;
  [self.badgeColor setFill];
  [[NSBezierPath bezierPathWithOvalInRect:NSInsetRect(bounds, 1, 1)] fill];
  NSDictionary *attributes = @{
    NSFontAttributeName: [NSFont systemFontOfSize:10 weight:NSFontWeightBold],
    NSForegroundColorAttributeName: NSColor.whiteColor,
  };
  NSSize textSize = [self.badgeLabel sizeWithAttributes:attributes];
  [self.badgeLabel drawAtPoint:NSMakePoint(NSMidX(bounds) - textSize.width / 2, NSMidY(bounds) - textSize.height / 2) withAttributes:attributes];
}
@end

namespace {

static NSMutableArray<NSPanel *> *gBadgePanels;
static NSArray<NSDictionary *> *gBadgeItems;
static AXObserverRef gDockObserver;
static id gActiveSpaceObserver;
static CFMachPortRef gInputEventTap;
static CFRunLoopSourceRef gInputEventSource;
static id gGlobalGestureMonitor;
static id gLocalGestureMonitor;
static id gGlobalScrollFallbackMonitor;
static id gLocalScrollFallbackMonitor;
static BOOL gRefreshScheduled;
static BOOL gSuppressForDockTransition;
static uint64_t gDockTransitionGeneration;
static NSArray<NSValue *> *gLastDockRects;
static CFAbsoluteTime gIgnoreSpaceInputUntil;

void RefreshBadgePanels();
void StartDockObservation();
void HideBadgePanels();

void SuppressBadgesForSpaceTransition() {
  if (gSuppressForDockTransition || gBadgeItems.count == 0) return;
  gSuppressForDockTransition = YES;
  const uint64_t generation = ++gDockTransitionGeneration;
  HideBadgePanels();
  // Horizontal scrolling can also be ordinary application content. Restore
  // automatically when no Space change follows; a real Space transition is
  // restored by NSWorkspaceActiveSpaceDidChangeNotification instead.
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 450 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    if (generation != gDockTransitionGeneration) return;
    gSuppressForDockTransition = NO;
    RefreshBadgePanels();
  });
}

NSColor *ColorFromHex(NSString *hex) {
  unsigned value = 0;
  NSScanner *scanner = [NSScanner scannerWithString:[hex stringByReplacingOccurrencesOfString:@"#" withString:@""]];
  [scanner scanHexInt:&value];
  return [NSColor colorWithSRGBRed:((value >> 16) & 0xff) / 255.0 green:((value >> 8) & 0xff) / 255.0 blue:(value & 0xff) / 255.0 alpha:1.0];
}

void ClearBadgePanels() {
  for (NSPanel *panel in gBadgePanels) [panel orderOut:nil];
  [gBadgePanels removeAllObjects];
}

void HideBadgePanels() {
  for (NSPanel *panel in gBadgePanels) [panel orderOut:nil];
}

bool CopyStringAttribute(AXUIElementRef element, CFStringRef name, NSString **result) {
  CFTypeRef value = nullptr;
  if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess || value == nullptr) return false;
  if (CFGetTypeID(value) != CFStringGetTypeID()) {
    CFRelease(value);
    return false;
  }
  *result = [(__bridge NSString *)value copy];
  CFRelease(value);
  return true;
}

bool CopyPointAttribute(AXUIElementRef element, CFStringRef name, CGPoint *result) {
  CFTypeRef value = nullptr;
  if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess || value == nullptr) return false;
  const AXValueType valueType = static_cast<AXValueType>(kAXValueCGPointType);
  const bool ok = CFGetTypeID(value) == AXValueGetTypeID()
    && AXValueGetType((AXValueRef)value) == valueType
    && AXValueGetValue((AXValueRef)value, valueType, result);
  CFRelease(value);
  return ok;
}

bool CopySizeAttribute(AXUIElementRef element, CFStringRef name, CGSize *result) {
  CFTypeRef value = nullptr;
  if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess || value == nullptr) return false;
  const AXValueType valueType = static_cast<AXValueType>(kAXValueCGSizeType);
  const bool ok = CFGetTypeID(value) == AXValueGetTypeID()
    && AXValueGetType((AXValueRef)value) == valueType
    && AXValueGetValue((AXValueRef)value, valueType, result);
  CFRelease(value);
  return ok;
}

bool CopyBooleanAttribute(AXUIElementRef element, CFStringRef name, bool *result) {
  CFTypeRef value = nullptr;
  if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess || value == nullptr) return false;
  if (CFGetTypeID(value) != CFBooleanGetTypeID()) {
    CFRelease(value);
    return false;
  }
  *result = CFBooleanGetValue((CFBooleanRef)value);
  CFRelease(value);
  return true;
}

bool IsTargetDockApplication(NSString *title, NSString *role, NSString *subrole) {
  NSString *normalizedTitle = [[title ?: @"" stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] lowercaseString];
  const bool matchesTitle = [normalizedTitle isEqualToString:@"codex"]
    || [normalizedTitle isEqualToString:@"chatgpt"];
  return matchesTitle
    && [role isEqualToString:(__bridge NSString *)kAXDockItemRole]
    && [subrole isEqualToString:(__bridge NSString *)kAXApplicationDockItemSubrole];
}

bool DisplayAtPointIsFullscreen(CGPoint point) {
  CGRect displayBounds = CGRectZero;
  bool foundDisplay = false;
  for (NSScreen *screen in NSScreen.screens) {
    NSNumber *screenNumber = screen.deviceDescription[@"NSScreenNumber"];
    if (screenNumber == nil) continue;
    const CGRect candidate = CGDisplayBounds(screenNumber.unsignedIntValue);
    if (CGRectContainsPoint(candidate, point)) {
      displayBounds = candidate;
      foundDisplay = true;
      break;
    }
  }
  if (!foundDisplay) return false;

  CFArrayRef windowInfo = CGWindowListCopyWindowInfo(
    kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
    kCGNullWindowID
  );
  if (windowInfo == nullptr) return false;
  bool fullscreen = false;
  for (NSDictionary *window in (__bridge NSArray *)windowInfo) {
    NSNumber *layer = window[(__bridge NSString *)kCGWindowLayer];
    NSNumber *alpha = window[(__bridge NSString *)kCGWindowAlpha];
    NSDictionary *boundsDictionary = window[(__bridge NSString *)kCGWindowBounds];
    CGRect bounds = CGRectZero;
    if (layer.intValue != 0
        || (alpha != nil && alpha.doubleValue <= 0)
        || boundsDictionary == nil
        || !CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)boundsDictionary, &bounds)) {
      continue;
    }
    const CGFloat tolerance = 2;
    const CGRect intersection = CGRectIntersection(bounds, displayBounds);
    const bool matchesFullscreenSize = fabs(bounds.size.width - displayBounds.size.width) <= tolerance
      && fabs(bounds.size.height - displayBounds.size.height) <= tolerance;
    const bool intersectsDisplay = !CGRectIsNull(intersection)
      && intersection.size.width > tolerance
      && intersection.size.height > tolerance;
    // During a Space swipe, macOS translates the destination fullscreen
    // window horizontally before it reaches the display origin. Treat a
    // display-sized window as fullscreen as soon as it intersects this
    // display, otherwise an all-Spaces badge is composited for a few frames.
    if (matchesFullscreenSize && intersectsDisplay) {
      fullscreen = true;
      break;
    }
  }
  CFRelease(windowInfo);
  return fullscreen;
}

void VisitDockElement(AXUIElementRef element, int depth, NSMutableArray<NSValue *> *rects, NSMutableSet<NSString *> *seen) {
  if (depth > 5) return;
  NSString *title = nil;
  NSString *role = nil;
  NSString *subrole = nil;
  CopyStringAttribute(element, kAXTitleAttribute, &title);
  CopyStringAttribute(element, kAXRoleAttribute, &role);
  CopyStringAttribute(element, kAXSubroleAttribute, &subrole);
  if (IsTargetDockApplication(title, role, subrole)) {
    bool hidden = false;
    // Hidden/auto-hidden Dock items can remain in the AX tree with a stale
    // frame. Do not leave a badge behind unless the item is currently visible.
    CopyBooleanAttribute(element, kAXHiddenAttribute, &hidden);
    CGPoint origin = CGPointZero;
    CGSize size = CGSizeZero;
    if (!hidden
        && CopyPointAttribute(element, kAXPositionAttribute, &origin)
        && CopySizeAttribute(element, kAXSizeAttribute, &size)
        && !DisplayAtPointIsFullscreen(CGPointMake(origin.x + size.width / 2, origin.y + size.height / 2))) {
      NSString *key = [NSString stringWithFormat:@"%.2f:%.2f:%.2f:%.2f", origin.x, origin.y, size.width, size.height];
      if (![seen containsObject:key]) {
        [seen addObject:key];
        [rects addObject:[NSValue valueWithRect:NSMakeRect(origin.x, origin.y, size.width, size.height)]];
      }
    }
  }

  CFTypeRef childrenValue = nullptr;
  if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &childrenValue) != kAXErrorSuccess || childrenValue == nullptr) return;
  if (CFGetTypeID(childrenValue) == CFArrayGetTypeID()) {
    CFArrayRef children = (CFArrayRef)childrenValue;
    for (CFIndex index = 0; index < CFArrayGetCount(children); index += 1) {
      AXUIElementRef child = (AXUIElementRef)CFArrayGetValueAtIndex(children, index);
      VisitDockElement(child, depth + 1, rects, seen);
    }
  }
  CFRelease(childrenValue);
}

NSMutableArray<NSValue *> *DiscoverDockRects() {
  NSArray<NSRunningApplication *> *dockApps = [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.apple.dock"];
  if (dockApps.count == 0) return [NSMutableArray array];
  const pid_t dockProcessIdentifier = dockApps.firstObject.processIdentifier;
  AXUIElementRef dock = AXUIElementCreateApplication(dockProcessIdentifier);
  NSMutableArray<NSValue *> *rects = [NSMutableArray array];
  VisitDockElement(dock, 0, rects, [NSMutableSet set]);
  CFRelease(dock);
  CGFloat minimumX = CGFLOAT_MAX;
  CGFloat maximumX = -CGFLOAT_MAX;
  CGFloat minimumY = CGFLOAT_MAX;
  CGFloat maximumY = -CGFLOAT_MAX;
  for (NSValue *value in rects) {
    const NSRect rect = value.rectValue;
    minimumX = MIN(minimumX, NSMidX(rect));
    maximumX = MAX(maximumX, NSMidX(rect));
    minimumY = MIN(minimumY, NSMidY(rect));
    maximumY = MAX(maximumY, NSMidY(rect));
  }
  // A bottom Dock lays items out horizontally; left and right Docks lay them
  // out vertically. Select the ordering axis from the discovered geometry so
  // badge identity remains aligned with the same item on every Dock edge.
  const bool sortAlongY = rects.count > 1 && (maximumY - minimumY) > (maximumX - minimumX);
  [rects sortUsingComparator:^NSComparisonResult(NSValue *left, NSValue *right) {
    const CGFloat leftPosition = sortAlongY ? NSMidY(left.rectValue) : NSMidX(left.rectValue);
    const CGFloat rightPosition = sortAlongY ? NSMidY(right.rectValue) : NSMidX(right.rectValue);
    return leftPosition < rightPosition ? NSOrderedAscending : leftPosition > rightPosition ? NSOrderedDescending : NSOrderedSame;
  }];
  return rects;
}

NSRect BadgePanelRectForDockRect(NSRect dockRect) {
  const NSPoint dockCenter = NSMakePoint(NSMidX(dockRect), NSMidY(dockRect));
  for (NSScreen *screen in NSScreen.screens) {
    NSNumber *screenNumber = screen.deviceDescription[@"NSScreenNumber"];
    if (screenNumber == nil) continue;
    const CGRect displayBounds = CGDisplayBounds(screenNumber.unsignedIntValue);
    if (!CGRectContainsPoint(displayBounds, dockCenter)) continue;
    const CGFloat localX = dockRect.origin.x - displayBounds.origin.x;
    const CGFloat localY = dockRect.origin.y - displayBounds.origin.y;
    return NSMakeRect(
      screen.frame.origin.x + localX + 2,
      screen.frame.origin.y + displayBounds.size.height - (localY + dockRect.size.height) + 2,
      18,
      18
    );
  }

  // AX uses the Core Graphics top-left coordinate space. The primary display
  // fallback remains stable even when another application becomes active.
  NSScreen *primaryScreen = NSScreen.screens.firstObject;
  NSNumber *screenNumber = primaryScreen.deviceDescription[@"NSScreenNumber"];
  const CGRect displayBounds = screenNumber == nil
    ? CGRectMake(0, 0, primaryScreen.frame.size.width, primaryScreen.frame.size.height)
    : CGDisplayBounds(screenNumber.unsignedIntValue);
  return NSMakeRect(
    primaryScreen.frame.origin.x + dockRect.origin.x - displayBounds.origin.x + 2,
    primaryScreen.frame.origin.y + displayBounds.size.height - (dockRect.origin.y - displayBounds.origin.y + dockRect.size.height) + 2,
    18,
    18
  );
}

bool DockRectsMoveOutward(NSArray<NSValue *> *previous, NSArray<NSValue *> *current) {
  if (previous.count == 0 || previous.count != current.count) return false;
  const CGFloat movementTolerance = 0.5;
  const CGFloat sizeTolerance = 1;
  for (NSUInteger index = 0; index < previous.count; index += 1) {
    const NSRect oldRect = previous[index].rectValue;
    const NSRect newRect = current[index].rectValue;
    if (fabs(oldRect.size.width - newRect.size.width) > sizeTolerance
        || fabs(oldRect.size.height - newRect.size.height) > sizeTolerance) {
      return false;
    }
    const NSPoint oldCenter = NSMakePoint(NSMidX(oldRect), NSMidY(oldRect));
    CGRect displayBounds = CGRectZero;
    bool foundDisplay = false;
    for (NSScreen *screen in NSScreen.screens) {
      NSNumber *screenNumber = screen.deviceDescription[@"NSScreenNumber"];
      if (screenNumber == nil) continue;
      const CGRect candidate = CGDisplayBounds(screenNumber.unsignedIntValue);
      if (CGRectContainsPoint(candidate, oldCenter)) {
        displayBounds = candidate;
        foundDisplay = true;
        break;
      }
    }
    if (!foundDisplay) return false;
    const CGFloat distanceToBottom = fabs(CGRectGetMaxY(displayBounds) - NSMaxY(oldRect));
    const CGFloat distanceToLeft = fabs(NSMinX(oldRect) - CGRectGetMinX(displayBounds));
    const CGFloat distanceToRight = fabs(CGRectGetMaxX(displayBounds) - NSMaxX(oldRect));
    const CGFloat deltaX = newRect.origin.x - oldRect.origin.x;
    const CGFloat deltaY = newRect.origin.y - oldRect.origin.y;
    const bool bottomDockMovesDown = distanceToBottom <= distanceToLeft
      && distanceToBottom <= distanceToRight
      && deltaY > movementTolerance;
    const bool leftDockMovesLeft = distanceToLeft < distanceToBottom
      && distanceToLeft <= distanceToRight
      && deltaX < -movementTolerance;
    const bool rightDockMovesRight = distanceToRight < distanceToBottom
      && distanceToRight < distanceToLeft
      && deltaX > movementTolerance;
    if (!bottomDockMovesDown && !leftDockMovesLeft && !rightDockMovesRight) return false;
  }
  return true;
}

CGEventRef InputEventTapCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *refcon) {
  (void)proxy;
  (void)refcon;
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    if (gInputEventTap != nullptr) CGEventTapEnable(gInputEventTap, true);
    return event;
  }
  if (CFAbsoluteTimeGetCurrent() < gIgnoreSpaceInputUntil) return event;

  bool beginsSpaceTransition = false;
  if (type == kCGEventScrollWheel) {
    const int64_t horizontal = llabs(CGEventGetIntegerValueField(event, kCGScrollWheelEventPointDeltaAxis2));
    const int64_t vertical = llabs(CGEventGetIntegerValueField(event, kCGScrollWheelEventPointDeltaAxis1));
    beginsSpaceTransition = horizontal > 0 && horizontal > vertical;
  }
  if (beginsSpaceTransition) SuppressBadgesForSpaceTransition();
  return event;
}

void StopInputObservation() {
  if (gGlobalGestureMonitor != nil) {
    [NSEvent removeMonitor:gGlobalGestureMonitor];
    gGlobalGestureMonitor = nil;
  }
  if (gLocalGestureMonitor != nil) {
    [NSEvent removeMonitor:gLocalGestureMonitor];
    gLocalGestureMonitor = nil;
  }
  if (gGlobalScrollFallbackMonitor != nil) {
    [NSEvent removeMonitor:gGlobalScrollFallbackMonitor];
    gGlobalScrollFallbackMonitor = nil;
  }
  if (gLocalScrollFallbackMonitor != nil) {
    [NSEvent removeMonitor:gLocalScrollFallbackMonitor];
    gLocalScrollFallbackMonitor = nil;
  }
  if (gInputEventSource != nullptr) {
    CFRunLoopRemoveSource(CFRunLoopGetMain(), gInputEventSource, kCFRunLoopCommonModes);
    CFRelease(gInputEventSource);
    gInputEventSource = nullptr;
  }
  if (gInputEventTap != nullptr) {
    CGEventTapEnable(gInputEventTap, false);
    CFRelease(gInputEventTap);
    gInputEventTap = nullptr;
  }
}

void StartInputObservation() {
  StopInputObservation();
  const CGEventMask eventMask = CGEventMaskBit(kCGEventScrollWheel);
  gInputEventTap = CGEventTapCreate(
    kCGSessionEventTap,
    kCGHeadInsertEventTap,
    kCGEventTapOptionListenOnly,
    eventMask,
    InputEventTapCallback,
    nullptr
  );
  if (gInputEventTap != nullptr) {
    gInputEventSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, gInputEventTap, 0);
    if (gInputEventSource != nullptr) {
      CFRunLoopAddSource(CFRunLoopGetMain(), gInputEventSource, kCFRunLoopCommonModes);
      CGEventTapEnable(gInputEventTap, true);
    } else {
      CFRelease(gInputEventTap);
      gInputEventTap = nullptr;
    }
  }

  void (^handleGesture)(NSEvent *) = ^(NSEvent *event) {
    if (CFAbsoluteTimeGetCurrent() < gIgnoreSpaceInputUntil) return;
    if (event.type == NSEventTypeSwipe
        && fabs(event.deltaX) > 0
        && fabs(event.deltaX) >= fabs(event.deltaY)) {
      SuppressBadgesForSpaceTransition();
    }
  };
  gGlobalGestureMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskSwipe handler:handleGesture];
  gLocalGestureMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskSwipe handler:^NSEvent *(NSEvent *event) {
    handleGesture(event);
    return event;
  }];

  // A listen-only CGEvent tap is preferred for scroll-based Space gestures.
  // Some macOS/trackpad configurations instead emit NSEventTypeSwipe, which
  // is observed above. If the OS declines the tap, retain a no-polling AppKit
  // scroll fallback for both active and inactive application states.
  if (gInputEventTap == nullptr) {
    void (^handleScroll)(NSEvent *) = ^(NSEvent *event) {
      if (CFAbsoluteTimeGetCurrent() < gIgnoreSpaceInputUntil) return;
      if (fabs(event.scrollingDeltaX) > 0 && fabs(event.scrollingDeltaX) > fabs(event.scrollingDeltaY)) {
        SuppressBadgesForSpaceTransition();
      }
    };
    gGlobalScrollFallbackMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:handleScroll];
    gLocalScrollFallbackMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^NSEvent *(NSEvent *event) {
      handleScroll(event);
      return event;
    }];
  }
}

void StopDockObservation() {
  StopInputObservation();
  if (gActiveSpaceObserver != nil) {
    [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:gActiveSpaceObserver];
    gActiveSpaceObserver = nil;
  }
  if (gDockObserver == nullptr) return;
  CFRunLoopSourceRef source = AXObserverGetRunLoopSource(gDockObserver);
  if (source != nullptr) CFRunLoopRemoveSource(CFRunLoopGetMain(), source, kCFRunLoopCommonModes);
  CFRelease(gDockObserver);
  gDockObserver = nullptr;
}

void ObserveDockTree(AXObserverRef observer, AXUIElementRef element, int depth) {
  if (depth > 5) return;
  const CFStringRef notifications[] = {
    kAXMovedNotification,
    kAXResizedNotification,
    kAXLayoutChangedNotification,
    kAXUIElementDestroyedNotification,
  };
  for (CFStringRef notification : notifications) {
    AXObserverAddNotification(observer, element, notification, nullptr);
  }
  CFTypeRef childrenValue = nullptr;
  if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &childrenValue) != kAXErrorSuccess || childrenValue == nullptr) return;
  if (CFGetTypeID(childrenValue) == CFArrayGetTypeID()) {
    CFArrayRef children = (CFArrayRef)childrenValue;
    for (CFIndex index = 0; index < CFArrayGetCount(children); index += 1) {
      ObserveDockTree(observer, (AXUIElementRef)CFArrayGetValueAtIndex(children, index), depth + 1);
    }
  }
  CFRelease(childrenValue);
}

void DockObserverCallback(AXObserverRef observer, AXUIElementRef element, CFStringRef notification, void *refcon) {
  (void)observer;
  (void)element;
  (void)refcon;
  NSArray<NSValue *> *currentRects = [DiscoverDockRects() copy];
  const bool beginsDockTransition = DockRectsMoveOutward(gLastDockRects, currentRects);
  if (beginsDockTransition || gSuppressForDockTransition) {
    gSuppressForDockTransition = YES;
    const uint64_t generation = ++gDockTransitionGeneration;
    HideBadgePanels();
    // Keep the marks hidden until Dock geometry has been quiet for a short
    // interval. ActiveSpaceDidChange normally restores them sooner, at the
    // exact end of a Space transition.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 350 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      if (generation != gDockTransitionGeneration) return;
      gSuppressForDockTransition = NO;
      RefreshBadgePanels();
    });
    return;
  }
  if (gRefreshScheduled) return;
  gRefreshScheduled = YES;
  // Reconcile on the first Dock movement before the next display frame. This
  // catches a display-sized fullscreen window while it is still sliding into
  // place and prevents the stationary panel from flashing in that Space.
  RefreshBadgePanels();
  const bool topologyChanged = CFEqual(notification, kAXLayoutChangedNotification)
    || CFEqual(notification, kAXUIElementDestroyedNotification);
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 16 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    gRefreshScheduled = NO;
    RefreshBadgePanels();
    if (topologyChanged) StartDockObservation();
  });
}

void StartDockObservation() {
  StopDockObservation();
  if (gBadgeItems.count == 0) return;
  NSArray<NSRunningApplication *> *dockApps = [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.apple.dock"];
  if (dockApps.count == 0) return;
  AXUIElementRef dock = AXUIElementCreateApplication(dockApps.firstObject.processIdentifier);
  if (AXObserverCreate(dockApps.firstObject.processIdentifier, DockObserverCallback, &gDockObserver) != kAXErrorSuccess || gDockObserver == nullptr) {
    CFRelease(dock);
    return;
  }
  ObserveDockTree(gDockObserver, dock, 0);
  CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(gDockObserver), kCFRunLoopCommonModes);
  StartInputObservation();
  gActiveSpaceObserver = [NSWorkspace.sharedWorkspace.notificationCenter
    addObserverForName:NSWorkspaceActiveSpaceDidChangeNotification
    object:nil
    queue:NSOperationQueue.mainQueue
    usingBlock:^(__unused NSNotification *notification) {
      // Restore only after the Space transition has completed. If the
      // destination is fullscreen, discovery keeps the panels hidden.
      gDockTransitionGeneration += 1;
      gSuppressForDockTransition = NO;
      gIgnoreSpaceInputUntil = CFAbsoluteTimeGetCurrent() + 0.25;
      RefreshBadgePanels();
    }];
  CFRelease(dock);
}

Napi::Value IsTrusted(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  const bool prompt = info.Length() > 0 && info[0].ToBoolean().Value();
  NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @(prompt)};
  return Napi::Boolean::New(env, AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options));
}

Napi::Value BundleIdentifier(const Napi::CallbackInfo &info) {
  NSString *bundleIdentifier = NSBundle.mainBundle.bundleIdentifier ?: @"";
  return Napi::String::New(info.Env(), bundleIdentifier.UTF8String ?: "");
}

Napi::Value DockRects(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  NSMutableArray<NSValue *> *rects = DiscoverDockRects();
  gLastDockRects = [rects copy];

  Napi::Array output = Napi::Array::New(env, rects.count);
  for (NSUInteger index = 0; index < rects.count; index += 1) {
    NSRect rect = rects[index].rectValue;
    Napi::Object item = Napi::Object::New(env);
    item.Set("x", Napi::Number::New(env, rect.origin.x));
    item.Set("y", Napi::Number::New(env, rect.origin.y));
    item.Set("width", Napi::Number::New(env, rect.size.width));
    item.Set("height", Napi::Number::New(env, rect.size.height));
    output.Set(index, item);
  }
  return output;
}

void RefreshBadgePanels() {
  if (gBadgeItems.count == 0) {
    ClearBadgePanels();
    return;
  }
  NSMutableArray<NSValue *> *rects = DiscoverDockRects();
  NSUInteger applied = MIN(gBadgeItems.count, rects.count);
  if (gBadgePanels == nil) gBadgePanels = [NSMutableArray arrayWithCapacity:applied];
  while (gBadgePanels.count > applied) {
    NSPanel *panel = gBadgePanels.lastObject;
    [panel orderOut:nil];
    [gBadgePanels removeLastObject];
  }
  for (NSUInteger index = 0; index < applied; index += 1) {
    NSDictionary *item = gBadgeItems[index];
    NSString *label = item[@"label"] ?: @"?";
    NSString *color = item[@"color"] ?: @"#0A84FF";
    NSRect dockRect = rects[index].rectValue;
    NSRect panelRect = BadgePanelRectForDockRect(dockRect);
    NSPanel *panel = index < gBadgePanels.count ? gBadgePanels[index] : nil;
    if (panel == nil) {
      panel = [[NSPanel alloc] initWithContentRect:panelRect styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
      panel.opaque = NO;
      panel.backgroundColor = NSColor.clearColor;
      panel.hasShadow = NO;
      panel.ignoresMouseEvents = YES;
      panel.hidesOnDeactivate = NO;
      panel.canHide = NO;
      panel.movable = NO;
      panel.movableByWindowBackground = NO;
      panel.excludedFromWindowsMenu = YES;
      panel.animationBehavior = NSWindowAnimationBehaviorNone;
      panel.level = CGWindowLevelForKey(kCGDockWindowLevelKey) + 1;
      // Stationary + CanJoinAllSpaces anchors the mark in display coordinates
      // while ordinary Spaces slide. FullScreenPrimary opts the panel out of
      // other applications' fullscreen window sets; FullScreenNone only says
      // that this panel cannot itself enter fullscreen and does not provide
      // that exclusion. Deliberately omit Auxiliary/CanJoinAllApplications.
      panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorStationary | NSWindowCollectionBehaviorIgnoresCycle | NSWindowCollectionBehaviorFullScreenPrimary | NSWindowCollectionBehaviorFullScreenDisallowsTiling;
      panel.contentView = [[CodexBadgeView alloc] initWithFrame:NSMakeRect(0, 0, 18, 18)];
      [gBadgePanels addObject:panel];
      [panel orderFrontRegardless];
    } else if (!NSEqualRects(panel.frame, panelRect)) {
      [panel setFrame:panelRect display:NO animate:NO];
    }
    CodexBadgeView *view = (CodexBadgeView *)panel.contentView;
    view.badgeLabel = label.length > 0 ? label : @"?";
    view.badgeColor = ColorFromHex(color);
    [view setNeedsDisplay:YES];
    if (!panel.isVisible) [panel orderFrontRegardless];
  }
}

Napi::Value SetEnvironmentBadges(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() == 0 || !info[0].IsArray()) {
    gBadgeItems = nil;
    gLastDockRects = nil;
    gSuppressForDockTransition = NO;
    gDockTransitionGeneration += 1;
    StopDockObservation();
    ClearBadgePanels();
    return Napi::Number::New(env, 0);
  }
  Napi::Array items = info[0].As<Napi::Array>();
  NSMutableArray<NSDictionary *> *normalized = [NSMutableArray arrayWithCapacity:items.Length()];
  for (uint32_t index = 0; index < items.Length(); index += 1) {
    Napi::Value raw = items.Get(index);
    if (!raw.IsObject()) continue;
    Napi::Object item = raw.As<Napi::Object>();
    NSString *label = [NSString stringWithUTF8String:item.Get("label").ToString().Utf8Value().c_str()];
    NSString *color = [NSString stringWithUTF8String:item.Get("color").ToString().Utf8Value().c_str()];
    [normalized addObject:@{ @"label": label ?: @"?", @"color": color ?: @"#0A84FF" }];
  }
  gBadgeItems = [normalized copy];
  RefreshBadgePanels();
  StartDockObservation();
  NSUInteger applied = MIN(gBadgeItems.count, DiscoverDockRects().count);
  return Napi::Number::New(env, applied);
}

Napi::Value ClearEnvironmentBadges(const Napi::CallbackInfo &info) {
  gBadgeItems = nil;
  gLastDockRects = nil;
  gSuppressForDockTransition = NO;
  gDockTransitionGeneration += 1;
  StopDockObservation();
  ClearBadgePanels();
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("isTrustedAccessibilityClient", Napi::Function::New(env, IsTrusted));
  exports.Set("getBundleIdentifier", Napi::Function::New(env, BundleIdentifier));
  exports.Set("getCodexDockRects", Napi::Function::New(env, DockRects));
  exports.Set("setEnvironmentBadges", Napi::Function::New(env, SetEnvironmentBadges));
  exports.Set("clearEnvironmentBadges", Napi::Function::New(env, ClearEnvironmentBadges));
  return exports;
}

}  // namespace

NODE_API_MODULE(app_environment_badge_native, Init)
