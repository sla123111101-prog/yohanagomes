const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('.main-nav');
const contactDialog = document.querySelector('#contact-dialog');
const contactOpen = document.querySelector('#contact-open');

toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  nav.classList.toggle('open', open);
});
nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  nav.classList.remove('open');
  toggle?.setAttribute('aria-expanded', 'false');
}));

contactOpen?.addEventListener('click', () => contactDialog?.showModal());
contactDialog?.querySelector('.dialog-close')?.addEventListener('click', () => contactDialog.close());
contactDialog?.addEventListener('click', event => {
  if (event.target === contactDialog) contactDialog.close();
});

document.querySelector('#year').textContent = new Date().getFullYear();

const videoIntro = document.querySelector('#video-intro');
const creatorVideo = document.querySelector('#creator-video');
const videoDisplay = creatorVideo?.closest('.video-display');
const videoTitle = document.querySelector('#creator-video-title');
const videoCounter = document.querySelector('#creator-video-counter');
const previousVideo = document.querySelector('#creator-video-previous');
const nextVideo = document.querySelector('#creator-video-next');
let presentationVideos = [];
let presentationVideoIndex = 0;

function showPresentationVideo(index) {
  if (!presentationVideos.length || !creatorVideo) return;
  presentationVideoIndex = (index + presentationVideos.length) % presentationVideos.length;
  const video = presentationVideos[presentationVideoIndex];
  creatorVideo.pause();
  creatorVideo.src = `/api/media?id=${encodeURIComponent(video.id)}&v=${encodeURIComponent(video.updatedAt || '')}`;
  if (videoDisplay) {
    videoDisplay.classList.remove('is-portrait');
    videoDisplay.style.removeProperty('--video-ratio');
    videoDisplay.style.removeProperty('--video-ratio-value');
  }
  if (videoTitle) videoTitle.textContent = video.title || '';
  if (videoCounter) videoCounter.textContent = `${String(presentationVideoIndex + 1).padStart(2, '0')} / ${String(presentationVideos.length).padStart(2, '0')}`;
  if (previousVideo) previousVideo.hidden = presentationVideos.length < 2;
  if (nextVideo) nextVideo.hidden = presentationVideos.length < 2;
  creatorVideo.load();
}

creatorVideo?.addEventListener('loadedmetadata', () => {
  const { videoWidth, videoHeight } = creatorVideo;
  if (!videoWidth || !videoHeight || !videoDisplay) return;
  const ratio = videoWidth / videoHeight;
  videoDisplay.style.setProperty('--video-ratio', `${videoWidth} / ${videoHeight}`);
  videoDisplay.style.setProperty('--video-ratio-value', String(ratio));
  videoDisplay.classList.toggle('is-portrait', ratio < 1);
});
previousVideo?.addEventListener('click', () => showPresentationVideo(presentationVideoIndex - 1));
nextVideo?.addEventListener('click', () => showPresentationVideo(presentationVideoIndex + 1));
fetch('/api/admin?action=public-status', { cache: 'no-store' })
  .then(response => response.ok ? response.json() : null)
  .then(status => {
    if (!status?.videos?.length || !videoIntro || !creatorVideo) return;
    presentationVideos = status.videos;
    videoIntro.hidden = false;
    showPresentationVideo(0);
  })
  .catch(() => {});
