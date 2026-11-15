/*
 * Browser page translation (Google Translate, Edge, Safari) replaces each text node it translates with
 * <font> elements of its own. React still holds the original node, so when it later removes that text, or
 * inserts before it, the DOM throws ("Failed to execute 'removeChild' on 'Node': The node to be removed is
 * not a child of this node") and the error boundary takes the whole screen down. Turning translation off
 * (translate="no") would shut out players who rely on it, so the two calls React makes are guarded instead:
 * a node that is no longer where React left it is removed from where it now is, or inserted at the end.
 * See https://github.com/facebook/react/issues/11538.
 */
let installed = false;

export function installTranslateGuard() {
  if (installed || typeof Node !== 'function') return;
  installed = true;
  const removeChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      // Moved or detached by the translator: take it out of wherever it is, if anywhere.
      if (child.parentNode) removeChild.call(child.parentNode, child);
      return child;
    }
    return removeChild.call(this, child) as T;
  };
  const insertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) {
      // The reference node was replaced: put the new one before what took its place, else at the end.
      let at: Node | null = ref;
      while (at && at.parentNode !== this) at = at.parentNode;
      return insertBefore.call(this, node, at) as T;
    }
    return insertBefore.call(this, node, ref) as T;
  };
}
