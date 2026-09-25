/**
 * Browser extensions and Chrome's page translation rewrite text nodes that
 * React owns. React then crashes when it removes or moves those nodes on the
 * next page change ("The node to be removed is not a child of this node"),
 * blanking the whole app. Tolerate that instead of throwing, as React's own
 * issue tracker suggests (facebook/react#11538).
 */
export function guardDomAgainstExtensions() {
  if (typeof Node !== "function" || !Node.prototype) return;
  const remove = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      if (child.parentNode) child.parentNode.removeChild(child);
      return child;
    }
    return remove.call(this, child) as T;
  };
  const insert = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) return this.appendChild(node) as T;
    return insert.call(this, node, ref) as T;
  };
}
