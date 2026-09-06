import { useEffect } from "react";
import { ArrowUpRight, Clock3, Heart, House, LockKeyhole, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type MeIntroductionProps = {
  albumName: string;
  photos: number;
  videos: number;
  onImport: () => void;
};

const values = [
  {
    icon: House,
    eyebrow: "KEPT AT HOME",
    title: "留在家里",
    body: "原片保存在自己的电脑里，不必把一家人的生活交给陌生的云端。",
  },
  {
    icon: Heart,
    eyebrow: "MADE TOGETHER",
    title: "一起补全",
    body: "一张照片不只是一个文件。家人可以评论、标记地点，把当时没说完的话补回来。",
  },
  {
    icon: Clock3,
    eyebrow: "FOR LATER",
    title: "慢慢回看",
    body: "不追赶更新，也不要求整理得完美。等某一天想起了，就能重新找到那段日子。",
  },
];

export default function MeIntroduction({
  albumName,
  photos,
  videos,
  onImport,
}: MeIntroductionProps) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "围炉 · Me";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className="me-page">
      <section className="me-hero" aria-labelledby="me-title">
        <div className="me-hero-copy">
          <span className="me-kicker">
            <Sparkles size={14} />
            A QUIET PLACE FOR OUR DAYS
          </span>
          <h1 id="me-title">
            把家里的照片，
            <br />
            变成一家人的时间。
          </h1>
          <p className="me-lede">
            Me 是一个放在家里的私人影像空间。不催你更新，也不要求生活井井有条；只是让那些普通、重要、来不及说完的日子，在多年以后还能够被重新看见。
          </p>
          <div className="me-actions">
            <Button size="lg" onClick={onImport}>
              收进新的日子
              <ArrowUpRight />
            </Button>
            <span className="me-security-note">
              <LockKeyhole size={15} />
              只保存在这台电脑上
            </span>
          </div>
        </div>
        <figure className="me-hero-art">
          <img
            src="/brand/me-hero.png"
            alt="木桌上的家庭相册、照片和一杯茶"
            width="1536"
            height="1024"
          />
          <figcaption>日子不用急着整理，先好好留下来。</figcaption>
        </figure>
      </section>

      <section className="me-intro-row" aria-label="相册概览">
        <div>
          <span className="me-section-kicker">OUR LITTLE ARCHIVE</span>
          <h2>{albumName}，从这里慢慢长大。</h2>
        </div>
        <div className="me-counts" aria-label="当前相册内容统计">
          <span>
            <b>{photos}</b> 张照片
          </span>
          <span>
            <b>{videos}</b> 段视频
          </span>
        </div>
      </section>

      <section className="me-values" aria-label="Me 的特点">
        {values.map(({ icon: Icon, eyebrow, title, body }) => (
          <article className="me-value" key={title}>
            <div className="me-value-icon">
              <Icon size={20} />
            </div>
            <span className="me-section-kicker">{eyebrow}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </section>

      <section className="me-closing">
        <div>
          <span className="me-section-kicker">A NOTE TO OUR FUTURE SELVES</span>
          <h2>有些日子，不需要被记录得完整。</h2>
          <p>只要在很久以后，还能打开它，看见当时的光、声音和我们。</p>
        </div>
        <div className="me-closing-mark" aria-hidden="true">
          <span>me</span>
          <small>家庭影像馆</small>
        </div>
      </section>
    </div>
  );
}
