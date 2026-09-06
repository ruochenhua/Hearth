import { Camera } from "lucide-react";

export default function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Camera size={23} />
      </span>
      <div>
        围炉<small>Hearth · 家庭影像馆</small>
      </div>
    </div>
  );
}
